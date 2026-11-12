import type {ElectronApplication, Locator, Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {waitForPlayer} from './support/playback';
import {seedProject} from './support/seed';
import {
  enabledDictionaries,
  importDictionaries,
  lookupDictionaries,
  setDictionariesEnabled,
  setDictionaryLanguages,
  setLanguageFull,
  waitForYomitan,
  writeTestDictionary,
  type TestDictionary
} from './support/yomitan-dictionaries';

// Tiny hand-made dictionaries; each headword is in exactly one of them unless said otherwise
const DICTS: TestDictionary[] = [
  {title: 'test-ja-en', sourceLanguage: 'ja', targetLanguage: 'en', terms: [{term: '本', glosses: ['book']}]},
  {title: 'test-en-en', sourceLanguage: 'en', targetLanguage: 'en', terms: [{term: 'apple', glosses: ['a round fruit']}]},
  {title: 'test-en-zh', sourceLanguage: 'en', targetLanguage: 'zh', terms: [
    {term: 'apple', glosses: ['苹果']},
    {term: 'wander', glosses: ['漫游'], rules: 'v'}
  ]},
  {title: 'test-zh-en', sourceLanguage: 'zh', targetLanguage: 'en', terms: [{term: '苹果', glosses: ['apple']}]},
  {title: 'test-ru-en', sourceLanguage: 'ru', targetLanguage: 'en', terms: [{term: 'яблоко', glosses: ['apple']}]},
  // Old format: no sourceLanguage/targetLanguage in index.json
  {title: 'test-legacy-en-zh', terms: [{term: 'orange', glosses: ['橙子']}]}
];
const ALL = DICTS.map(d => d.title).sort();

/** Counts the renderer's language syncs (project open, Global Settings closed), so a test can wait for the next one. */
function countSyncs(ui: Page): () => number {
  let count = 0;
  ui.on('console', message => {
    if (message.text().includes('[ProjectDetails] Yomitan Sync:')) {
      count++;
    }
  });
  return () => count;
}

/** Opens Global Settings, closes it and waits for the language sync that closing it starts. */
async function closeGlobalSettings(ui: Page, syncs: () => number): Promise<void> {
  const before = syncs();
  await ui.keyboard.press('o');
  const dialog = ui.locator('.p-dialog', {hasText: 'Global Settings'});
  await expect(dialog).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(syncs, {timeout: 15_000}).toBeGreaterThan(before);
}

/** Opens Global Settings on the Offline Dictionaries tab and waits for the Yomitan page in it. */
async function openOfflineDictionaries(ui: Page): Promise<Locator> {
  await ui.keyboard.press('o');
  const dialog = ui.locator('.p-dialog', {hasText: 'Global Settings'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', {name: 'Offline Dictionaries'}).click();
  await expect(dialog.locator('webview')).toBeAttached();
  await expect(dialog.locator('.webview-container app-spinner')).toHaveCount(0, {timeout: 30_000});
  return dialog;
}

/** Imports through the Yomitan page of the tab, as if the files had been picked in its import box. */
async function importInTab(app: ElectronApplication, ui: Page, files: string[]): Promise<void> {
  const id: number = await ui.evaluate(() => (document.querySelector('webview') as any).getWebContentsId());
  await app.evaluate(async ({webContents}, {id, files}) => {
    const cdp = webContents.fromId(id)!.debugger;
    cdp.attach('1.3');
    try {
      const {root} = await cdp.sendCommand('DOM.getDocument', {depth: 0});
      const {nodeId} = await cdp.sendCommand('DOM.querySelector', {nodeId: root.nodeId, selector: '#dictionary-import-file-input'});
      await cdp.sendCommand('DOM.setFileInputFiles', {nodeId, files});
    } finally {
      cdp.detach();
    }
  }, {id, files});
}

async function pickLanguage(ui: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.locator('p-select').first().click();
  const overlay = ui.locator('.p-select-overlay');
  await overlay.locator('input').fill(name.split(' ')[0]);
  await overlay.getByRole('option', {name}).click();
}

test.describe('Yomitan dictionaries and the subtitle language', () => {
  test('each language keeps its own dictionary switches; a new language starts with its own dictionaries on', async ({launch}, testInfo) => {
    const {app, ui} = await launch();
    await waitForYomitan(ui);
    await setLanguageFull(ui, 'en');
    const files = DICTS.map(d => writeTestDictionary(testInfo.outputPath('dicts'), d));
    await importDictionaries(app, ui, files);
    // Yomitan switches every imported dictionary on; they were imported while English was set up
    expect(await enabledDictionaries(ui)).toEqual(ALL);

    // The old-format one has no language: nothing guesses it, the sync reports it until the user gives one
    expect(await setLanguageFull(ui, 'en')).toEqual(['test-legacy-en-zh']);
    await setDictionaryLanguages(ui, {'test-legacy-en-zh': 'en'});

    // First use of a language: the dictionaries of that language
    expect(await setLanguageFull(ui, 'ru')).toEqual([]);
    expect(await enabledDictionaries(ui)).toEqual(['test-ru-en']);
    await setLanguageFull(ui, 'ja');
    expect(await enabledDictionaries(ui)).toEqual(['test-ja-en']);

    // Back to English: the switches it was left with
    await setLanguageFull(ui, 'en');
    expect(await enabledDictionaries(ui)).toEqual(ALL);

    // The user narrows English down; Japanese is left alone and English comes back narrowed
    await setDictionariesEnabled(ui, {'test-ja-en': false, 'test-ru-en': false, 'test-zh-en': false});
    await setLanguageFull(ui, 'ja');
    expect(await enabledDictionaries(ui)).toEqual(['test-ja-en']);
    await setLanguageFull(ui, 'en');
    expect(await enabledDictionaries(ui)).toEqual(['test-en-en', 'test-en-zh', 'test-legacy-en-zh']);
  });

  test('lookups search every enabled dictionary, whatever its language and order', async ({launch}, testInfo) => {
    const {app, ui} = await launch();
    await waitForYomitan(ui);
    const files = DICTS.map(d => writeTestDictionary(testInfo.outputPath('dicts'), d));
    await importDictionaries(app, ui, files);
    const all = Object.fromEntries(DICTS.map(d => [d.title, true]));

    const results: Record<string, Record<string, string[]>> = {};
    for (const lang of ['en', 'ja', 'zh', 'ru']) {
      await setLanguageFull(ui, lang);
      await setDictionariesEnabled(ui, all);
      results[lang] = {};
      for (const word of ['apple', 'wanders', 'Apple', '本', '本です', '苹果', 'яблоко', 'orange']) {
        results[lang][word] = await lookupDictionaries(ui, word);
      }
    }
    console.log('[dicts] lookups with all dictionaries on', JSON.stringify(results));

    // English profile: an English word is answered by both English-headword dictionaries, the Japanese one listed
    // first does not stop the search, and the inflected form is found through the English deinflector
    expect(results['en']['apple']).toEqual(['test-en-en', 'test-en-zh']);
    expect(results['en']['wanders']).toEqual(['test-en-zh']);
    expect(results['en']['本']).toEqual(['test-ja-en']);
    expect(results['en']['яблоко']).toEqual(['test-ru-en']);
    expect(results['en']['orange']).toEqual(['test-legacy-en-zh']);
    // What the profile language does change is how the text is cut and normalised: a Japanese word inside running
    // Japanese text is found only when the profile is Japanese (letter by letter), not under English (word by word)
    expect(results['ja']['本です']).toEqual(['test-ja-en']);
    expect(results['en']['本です']).toEqual([]);
    // A zh->en dictionary has Chinese headwords: it can never answer an English word (#16)
    for (const lang of ['en', 'ja', 'zh', 'ru']) {
      expect(results[lang]['apple']).not.toContain('test-zh-en');
    }
  });

  test('closing Global Settings keeps the dictionaries the user switched on (#19), also after a restart', async ({launch}, testInfo) => {
    const first = await launch({seed: dir => seedProject(dir, {settings: {subtitlesLanguage: 'en'}})});
    const syncs = countSyncs(first.ui);
    await waitForPlayer(first.ui);
    await waitForYomitan(first.ui);
    await expect.poll(syncs, {timeout: 15_000}).toBeGreaterThan(0);

    const picked = DICTS.filter(d => ['test-en-en', 'test-ru-en', 'test-ja-en', 'test-en-zh'].includes(d.title));
    await importDictionaries(first.app, first.ui, picked.map(d => writeTestDictionary(testInfo.outputPath('dicts'), d)));
    // As in the #19 recording: the user switches all of them on, here with the English set narrowed by one
    await setDictionariesEnabled(first.ui, {'test-en-en': true, 'test-ru-en': true, 'test-ja-en': true, 'test-en-zh': false});
    const chosen = ['test-en-en', 'test-ja-en', 'test-ru-en'];
    expect(await enabledDictionaries(first.ui)).toEqual(chosen);

    const before = syncs();
    await first.ui.keyboard.press('o');
    const dialog = first.ui.locator('.p-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.dictionary-hint')).toHaveCount(0); // the hint is on the Offline Dictionaries tab
    await dialog.getByRole('tab', {name: 'Offline Dictionaries'}).click();
    await expect(dialog.locator('.dictionary-hint')).toContainText('en-zh');
    await first.ui.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(syncs, {timeout: 15_000}).toBeGreaterThan(before);
    expect(await enabledDictionaries(first.ui)).toEqual(chosen);

    // Same profile after a restart: the project opens, syncs English again, and the choice is still there
    await first.app.close();
    const second = await launch({env: {YALL_MP_USER_DATA_DIR: first.userDataDir}});
    const syncsAfter = countSyncs(second.ui);
    await waitForPlayer(second.ui);
    await expect.poll(syncsAfter, {timeout: 15_000}).toBeGreaterThan(0);
    expect(await enabledDictionaries(second.ui)).toEqual(chosen);
  });

  test('a dictionary without a language is asked about right after the import, and its language can be edited later', async ({launch}, testInfo) => {
    const {app, ui, userDataDir} = await launch({seed: dir => seedProject(dir, {settings: {subtitlesLanguage: 'en'}})});
    const syncs = countSyncs(ui);
    await waitForPlayer(ui);
    await waitForYomitan(ui);
    await expect.poll(syncs, {timeout: 15_000}).toBeGreaterThan(0);
    const picked = DICTS.filter(d => ['test-en-en', 'test-legacy-en-zh'].includes(d.title));

    const settings = await openOfflineDictionaries(ui);
    await expect(settings.locator('.dictionary-languages-banner')).toHaveCount(0);
    await importInTab(app, ui, picked.map(d => writeTestDictionary(testInfo.outputPath('dicts'), d)));

    // Asked as soon as the import is done, over Global Settings; "Not now" leaves a banner on the tab
    const languageDialog = ui.locator('.p-dialog', {hasText: 'Which language are these dictionaries for?'});
    await expect(languageDialog).toBeVisible({timeout: 30_000});
    await expect(languageDialog.locator('.dictionary-title')).toHaveText(['test-legacy-en-zh']);
    await expect(languageDialog).toContainText('change this later');
    await languageDialog.getByRole('button', {name: 'Not now'}).click();
    await expect(languageDialog).toBeHidden();
    const banner = settings.locator('.dictionary-languages-banner');
    await expect(banner).toContainText('1 dictionary does not say which language it is for');

    await banner.getByRole('button', {name: 'Set languages'}).click();
    await expect(languageDialog).toBeVisible();
    await pickLanguage(ui, languageDialog, 'English (en)');
    await languageDialog.getByRole('button', {name: 'Save'}).click();
    await expect(languageDialog).toBeHidden();
    await expect(banner).toContainText('1 dictionary uses a language you picked');
    const stored = () => JSON.parse(fs.readFileSync(path.join(userDataDir, 'yomitan-dictionary-switches.json'), 'utf-8'));
    await expect.poll(() => stored().dictionaryLanguages).toEqual({'test-legacy-en-zh': 'en'});

    // Closing Global Settings does not ask again; the dictionary follows English like one that declares it
    await ui.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await new Promise(r => setTimeout(r, 1000));
    await expect(languageDialog).toBeHidden();
    expect(await setLanguageFull(ui, 'ja')).toEqual([]);
    expect(await enabledDictionaries(ui)).toEqual([]);
    expect(await setLanguageFull(ui, 'en')).toEqual([]);
    expect(await enabledDictionaries(ui)).toEqual(['test-en-en', 'test-legacy-en-zh']);

    // A wrong answer is fixed by editing it: the dictionary starts over with the new language, everywhere
    const again = await openOfflineDictionaries(ui);
    await again.locator('.dictionary-languages-banner').getByRole('button', {name: 'Edit languages'}).click();
    await expect(languageDialog).toBeVisible();
    await pickLanguage(ui, languageDialog, 'Japanese (ja)');
    await languageDialog.getByRole('button', {name: 'Save'}).click();
    await expect(languageDialog).toBeHidden();
    await expect.poll(() => stored().dictionaryLanguages).toEqual({'test-legacy-en-zh': 'ja'});
    await expect.poll(() => enabledDictionaries(ui)).toEqual(['test-en-en']);
    await ui.keyboard.press('Escape');
    await expect(again).toBeHidden();
    await setLanguageFull(ui, 'ja');
    expect(await enabledDictionaries(ui)).toEqual(['test-legacy-en-zh']);
  });
});
