import type {ElectronApplication, Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/** One headword of a test dictionary: the term and its glosses. */
export interface TestTerm {
  term: string;
  glosses: string[];
  /** Yomitan deinflection rules of the headword, e.g. 'v' for an English verb */
  rules?: string;
}

export interface TestDictionary {
  title: string;
  /** Left out for an old-format dictionary that has no language metadata */
  sourceLanguage?: string;
  targetLanguage?: string;
  terms: TestTerm[];
}

/** A zip that stores its entries uncompressed; Yomitan's importer reads it like any other dictionary archive. */
function storedZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const {name, data} of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Writes a format 3 Yomitan dictionary archive and returns its path. */
export function writeTestDictionary(dir: string, dict: TestDictionary): string {
  const index: Record<string, unknown> = {title: dict.title, revision: '1', format: 3, sequenced: false};
  if (dict.sourceLanguage) {
    index['sourceLanguage'] = dict.sourceLanguage;
  }
  if (dict.targetLanguage) {
    index['targetLanguage'] = dict.targetLanguage;
  }
  // [term, reading, definitionTags, rules, score, glossary, sequence, termTags]
  const bank = dict.terms.map((t, i) => [t.term, '', '', t.rules ?? '', 0, t.glosses, i + 1, '']);
  const zip = storedZip([
    {name: 'index.json', data: Buffer.from(JSON.stringify(index), 'utf8')},
    {name: 'term_bank_1.json', data: Buffer.from(JSON.stringify(bank), 'utf8')}
  ]);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${dict.title}.zip`);
  fs.writeFileSync(file, zip);
  return file;
}

export async function invokeYomitan(ui: Page, message: unknown): Promise<any> {
  return ui.evaluate(m => (window as any).electronAPI.invokeExtension(m), message);
}

export async function waitForYomitan(ui: Page, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await ui.evaluate(() => (window as any).electronAPI.invokeExtensionReadyCheck())) {
      return;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Yomitan proxy did not become ready');
}

/** Dictionaries of the current Yomitan profile, in their order, with the switch state. */
export async function profileDictionaries(ui: Page): Promise<{ name: string; enabled: boolean }[]> {
  const response = await invokeYomitan(ui, {action: 'optionsGet', params: {optionsContext: {current: true}}});
  return (response?.result?.dictionaries ?? []).map((d: any) => ({name: d.name, enabled: d.enabled}));
}

export async function enabledDictionaries(ui: Page): Promise<string[]> {
  return (await profileDictionaries(ui)).filter(d => d.enabled).map(d => d.name).sort();
}

/**
 * Imports the archives the way a user does: through the file input of Yomitan's own settings page, opened in a
 * hidden window of its own. Every imported dictionary is switched on in the current profile, as Yomitan does.
 */
export async function importDictionaries(app: ElectronApplication, ui: Page, files: string[]): Promise<void> {
  const before = (await profileDictionaries(ui)).length;
  const extensionId: string = await ui.evaluate(() => (window as any).electronAPI.getYomitanExtensionId());
  const settingsUrl = `chrome-extension://${extensionId}/settings.html`;

  const pagePromise = app.waitForEvent('window', {predicate: p => p.url().startsWith(settingsUrl)});
  await app.evaluate(({BrowserWindow}, url) => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800});
    (globalThis as any).__e2eDictionarySettingsWindow = win;
    void win.loadURL(url);
  }, settingsUrl);
  const settings = await pagePromise;
  await settings.waitForLoadState('domcontentloaded');
  await settings.locator('#dictionary-import-file-input').waitFor({state: 'attached'});
  // The settings page wires its controllers after load; give it a moment before the import starts
  await settings.waitForFunction(() => document.documentElement.dataset['loaded'] === 'true' || document.readyState === 'complete');
  await settings.waitForTimeout(1000);
  await settings.locator('#dictionary-import-file-input').setInputFiles(files);

  const deadline = Date.now() + 30_000;
  while ((await profileDictionaries(ui)).length < before + files.length) {
    if (Date.now() > deadline) {
      throw new Error(`Import did not finish: ${JSON.stringify(await profileDictionaries(ui))}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  await app.evaluate(() => (globalThis as any).__e2eDictionarySettingsWindow?.destroy());
}

/** Switches dictionaries on or off in the current profile, like the switches on the Offline Dictionaries tab. */
export async function setDictionariesEnabled(ui: Page, enabled: Record<string, boolean>): Promise<void> {
  const dicts = await profileDictionaries(ui);
  const targets = dicts
    .map((d, i) => ({d, i}))
    .filter(({d}) => d.name in enabled)
    .map(({d, i}) => ({
      action: 'set', path: `dictionaries[${i}].enabled`, value: enabled[d.name],
      scope: 'profile', optionsContext: {current: true}
    }));
  await invokeYomitan(ui, {action: 'modifySettings', params: {targets, source: 'e2e'}});
}

/** Names of the dictionaries that answered a lookup, as the popup would list them. */
export async function lookupDictionaries(ui: Page, text: string): Promise<string[]> {
  const response = await invokeYomitan(ui, {
    action: 'termsFind',
    params: {text, optionsContext: {current: true}, details: {matchType: 'exact', deinflect: true}}
  });
  const names = new Set<string>();
  for (const entry of response?.result?.dictionaryEntries ?? []) {
    for (const definition of entry.definitions ?? []) {
      names.add(definition.dictionary);
    }
  }
  return [...names].sort();
}

/** Runs the main process language sync; returns the dictionaries whose language is still unknown. */
export async function setLanguageFull(ui: Page, iso: string): Promise<string[]> {
  const result = await ui.evaluate(lang => (window as any).electronAPI.setYomitanLanguageFull(lang), iso);
  return result.unknownDictionaries;
}

export async function setDictionaryLanguages(ui: Page, languages: Record<string, string>): Promise<void> {
  await ui.evaluate(l => (window as any).electronAPI.setYomitanDictionaryLanguages(l), languages);
}
