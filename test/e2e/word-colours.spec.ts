import * as fs from 'fs';
import type {Page} from '@playwright/test';
import {expect, test} from './support/app';
import {waitForPlayer} from './support/playback';
import {seekTo} from './support/player';
import {fixture, seedProject} from './support/seed';
import {importDictionaries, invokeYomitan, TestDictionary, waitForYomitan, writeTestDictionary} from './support/yomitan-dictionaries';

/**
 * Word colouring by gender in the real app: a German project, a small dictionary with wty-style gender tags,
 * the colours painted with the CSS Custom Highlight API (the subtitle DOM itself is never changed).
 */
const GERMAN: TestDictionary = {
  title: 'test-de-gender',
  sourceLanguage: 'de',
  targetLanguage: 'en',
  tagBank: [['n', 'partOfSpeech'], ['masc', 'gender-masculine'], ['fem', 'gender-feminine'], ['neut', 'gender-neuter']],
  terms: [
    {term: 'Weisheit', glosses: ['wisdom'], tags: 'n fem'},
    {term: 'Segen', glosses: ['blessing'], tags: 'n masc'},
    {term: 'Pferd', glosses: ['horse'], tags: 'n neut'}
  ]
};

// Same timings as sample.srt (the seed's subtitle count and end time match it)
const SRT = `1
00:00:00,500 --> 00:00:02,500
Meine Weisheit ist ein <i>Segen</i>.

2
00:00:03,500 --> 00:00:05,500
Das Pferd.

3
00:00:06,500 --> 00:00:08,500
Nichts.
`;

type Painted = Record<'m' | 'f' | 'n' | 'x', string[]>;

function painted(ui: Page): Promise<Painted> {
  return ui.evaluate(() => {
    const read = (name: string) => {
      const h = CSS.highlights.get(name);
      return h ? [...h].map(r => r.toString()) : [];
    };
    return {m: read('yall-gender-m'), f: read('yall-gender-f'), n: read('yall-gender-n'), x: read('yall-gender-x')};
  });
}

const COLOURED: Painted = {m: ['ein', 'Segen'], f: ['Meine', 'Weisheit'], n: [], x: []};

async function openWordColouringTab(ui: Page) {
  await ui.keyboard.press('o');
  const dialog = ui.locator('.p-dialog', {hasText: 'Global Settings'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', {name: 'Word Colouring'}).click();
  await expect(dialog.getByText('Colour words by gender')).toBeVisible();
  return dialog;
}

/** Counts the renderer's language syncs (project open, Global Settings closed). */
function countSyncs(ui: Page): () => number {
  let count = 0;
  ui.on('console', message => {
    if (message.text().includes('[ProjectDetails] Yomitan Sync:')) {
      count++;
    }
  });
  return () => count;
}

test.describe('word colours', () => {
  test('off by default; once on, nouns and their articles are coloured by gender for the listed languages, without touching the subtitle DOM; Ctrl+Shift+G toggles it', async ({launch}, testInfo) => {
    const srt = testInfo.outputPath('german.srt');
    fs.writeFileSync(srt, SRT);
    const {app, ui} = await launch({
      seed: dir => seedProject(dir, {media: fixture('sample.mp4'), subtitle: srt, lastPlaybackTime: 1.0, settings: {subtitlesLanguage: 'de'}})
    });
    const syncs = countSyncs(ui);
    await waitForPlayer(ui);
    await waitForYomitan(ui);
    // The project's own language sync rewrites the profile's dictionary list: let it set German, and let Yomitan's
    // database open, before importing
    await expect.poll(async () => (await invokeYomitan(ui, {action: 'optionsGet', params: {optionsContext: {current: true}}}))?.result?.general?.language,
      {timeout: 15_000}).toBe('de');
    await expect.poll(async () => Array.isArray((await invokeYomitan(ui, {action: 'getDictionaryInfo', params: {}}))?.result),
      {timeout: 15_000}).toBe(true);
    await expect(ui.locator('.srt-container')).toContainText('Meine Weisheit');

    // Off by default, and no dictionary yet: nothing to colour
    expect(await painted(ui)).toEqual({m: [], f: [], n: [], x: []});

    // A dictionary is imported, colouring is switched on in its tab, Global Settings is closed (that re-syncs Yomitan
    // and starts the colouring over)
    await importDictionaries(app, ui, [writeTestDictionary(testInfo.outputPath('dicts'), GERMAN)]);
    const before = syncs();
    const dialog = await openWordColouringTab(ui);
    if (process.env['YALL_MP_E2E_WORD_COLOURS_TAB_SHOT']) {
      fs.writeFileSync(process.env['YALL_MP_E2E_WORD_COLOURS_TAB_SHOT'], await dialog.screenshot());
    }
    const enabled = dialog.locator('#word-colouring-enabled');
    await expect(enabled).not.toBeChecked();
    await dialog.getByText('Colour words by gender').click();
    await expect(enabled).toBeChecked();
    await ui.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(syncs, {timeout: 15_000}).toBeGreaterThan(before);

    // "Segen" sits in its own <i> node; "Meine" and "ein" agree with their nouns
    await expect.poll(() => painted(ui), {timeout: 15_000}).toEqual(COLOURED);
    await expect(ui.locator('.srt-container span')).toHaveJSProperty('innerHTML', 'Meine Weisheit ist ein <i>Segen</i>.');
    const shot = await ui.locator('.srt-container').screenshot();
    await testInfo.attach('coloured-line.png', {body: shot, contentType: 'image/png'});
    if (process.env['YALL_MP_E2E_WORD_COLOURS_SHOT']) {
      fs.writeFileSync(process.env['YALL_MP_E2E_WORD_COLOURS_SHOT'], shot);
    }

    // German taken off the language list: plain again; the reset puts it back
    const settings = await openWordColouringTab(ui);
    const languagesShot = process.env['YALL_MP_E2E_WORD_COLOURS_LANGUAGES_SHOT'];
    if (languagesShot) {
      const fieldset = settings.locator('p-fieldset', {hasText: 'Only subtitles in these languages'});
      await fieldset.scrollIntoViewIfNeeded();
      fs.writeFileSync(languagesShot, await fieldset.screenshot());
      // The arrow: the middle of the field can be a chip's remove icon
      await settings.locator('[data-testid="word-colouring-languages"] .p-multiselect-dropdown').click();
      await ui.keyboard.type('po');
      await ui.waitForTimeout(300);
      fs.writeFileSync(languagesShot.replace(/\.png$/, '-open.png'), await ui.screenshot());
      await ui.keyboard.press('Escape');
      await expect(ui.locator('.p-multiselect-overlay')).toBeHidden();
    }
    await settings.locator('[data-testid="word-colouring-languages"] .p-multiselect-chip-item', {hasText: 'German'})
      .locator('.p-chip-remove-icon').click();
    await expect.poll(() => painted(ui)).toEqual({m: [], f: [], n: [], x: []});
    await settings.getByRole('button', {name: 'Reset languages to default'}).click();
    await expect.poll(() => painted(ui), {timeout: 15_000}).toEqual(COLOURED);
    await ui.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    // Off and on again from the keyboard
    await ui.keyboard.press('ControlOrMeta+Shift+G');
    await expect.poll(() => painted(ui)).toEqual({m: [], f: [], n: [], x: []});
    await ui.keyboard.press('ControlOrMeta+Shift+G');
    await expect.poll(() => painted(ui), {timeout: 15_000}).toEqual(COLOURED);

    // The next line is coloured when it shows
    await seekTo(ui, 4.0);
    await expect(ui.locator('.srt-container')).toContainText('Das Pferd');
    await expect.poll(() => painted(ui), {timeout: 15_000}).toEqual({m: [], f: [], n: ['Das', 'Pferd'], x: []});
  });
});
