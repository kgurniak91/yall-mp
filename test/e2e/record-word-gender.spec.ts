import * as fs from 'fs';
import * as path from 'path';
import {test} from './support/app';
import {REPO_ROOT} from './support/app';
import {importDictionaries, invokeYomitan, profileDictionaries, setDictionariesEnabled, setLanguageFull, waitForYomitan} from './support/yomitan-dictionaries';

/**
 * Not a test: records what the real bundled Yomitan returns for the words in test/fixtures/word-gender/words.json,
 * looked up in real dictionaries, so the word-gender unit tests run against real responses. Runs only when
 * YALL_MP_RECORD_GENDER_DICTS points at a folder with the archives (`wty-de-en.zip`, `kty-de-en.zip`, ...):
 *
 *   YALL_MP_RECORD_GENDER_DICTS=path/to/dicts npx playwright test record-word-gender
 *
 * Writes test/fixtures/word-gender/<dictionary>.json. Only the fields the colouring reads are kept (headwords, tags,
 * sources, rule chains, the dictionary name); glossaries are left out.
 */
const DICTS_DIR = process.env['YALL_MP_RECORD_GENDER_DICTS'];
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'word-gender');
const SOURCE: {words: Record<string, string[]>; sentences: Record<string, string[]>} =
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'words.json'), 'utf8'));
const LANGUAGES = Object.keys(SOURCE.words);

/** The listed words, every word of the sentences, both halves of an elision ("l'eau": "l'", "eau"), and lowercase forms. */
function wordsOf(lang: string): string[] {
  const out = new Set<string>(SOURCE.words[lang]);
  const segmenter = new Intl.Segmenter(lang, {granularity: 'word'});
  for (const sentence of SOURCE.sentences[lang] ?? []) {
    for (const seg of segmenter.segment(sentence)) {
      if (!seg.isWordLike) {
        continue;
      }
      const pieces = [seg.segment];
      const elision = /^(.+?['’])(.+)$/u.exec(seg.segment);
      if (elision) {
        pieces.push(elision[1], elision[2]);
      }
      for (const piece of pieces) {
        out.add(piece);
        out.add(piece.toLocaleLowerCase(lang));
      }
    }
  }
  return [...out];
}

function trimTag(tag: any): unknown {
  return {name: tag.name, category: tag.category};
}

function trimResponse(response: any): unknown {
  const result = response?.result;
  if (!result) {
    return {error: response?.error ?? 'no result'};
  }
  return {
    originalTextLength: result.originalTextLength,
    dictionaryEntries: (result.dictionaryEntries ?? []).map((e: any) => ({
      score: e.score,
      inflectionRuleChainCandidates: e.inflectionRuleChainCandidates,
      headwords: (e.headwords ?? []).map((h: any) => ({
        term: h.term,
        reading: h.reading,
        tags: (h.tags ?? []).map(trimTag),
        sources: h.sources
      })),
      definitions: (e.definitions ?? []).map((d: any) => ({
        dictionary: d.dictionary,
        tags: (d.tags ?? []).map(trimTag)
      }))
    }))
  };
}

test.describe('record word-gender fixtures', () => {
  test.skip(!DICTS_DIR, 'set YALL_MP_RECORD_GENDER_DICTS to record');

  for (const lang of LANGUAGES) {
    test(`record ${lang}`, async ({launch}) => {
      test.setTimeout(20 * 60_000);
      const files = ['wty', 'kty']
        .map(family => path.join(DICTS_DIR!, `${family}-${lang}-en.zip`))
        .filter(f => fs.existsSync(f));
      test.skip(files.length === 0, `no ${lang} archives`);

      const {app, ui} = await launch();
      await waitForYomitan(ui);
      await setLanguageFull(ui, lang);
      for (const file of files) {
        await importDictionaries(app, ui, [file], 15 * 60_000);
      }
      const names = (await profileDictionaries(ui)).map(d => d.name);

      for (const name of names) {
        await setLanguageFull(ui, lang);
        await setDictionariesEnabled(ui, Object.fromEntries(names.map(n => [n, n === name])));
        const lookups: Record<string, unknown> = {};
        for (const word of wordsOf(lang)) {
          const response = await invokeYomitan(ui, {
            action: 'termsFind',
            params: {text: word, optionsContext: {current: true}, details: {matchType: 'exact', deinflect: true}}
          });
          lookups[word] = trimResponse(response);
        }
        const out = {dictionary: name, language: lang, recorded: new Date().toISOString().slice(0, 10), lookups};
        fs.mkdirSync(FIXTURES, {recursive: true});
        fs.writeFileSync(path.join(FIXTURES, `${name}.json`), JSON.stringify(out, null, 1) + '\n');
      }
    });
  }
});
