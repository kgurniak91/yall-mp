import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  forgetDictionarySwitches,
  loadDictionaryStore,
  planDictionarySwitches,
  resolveDictionaryLanguages,
  saveDictionaryStore,
  type DictionarySwitchInput
} from '../dictionary-switches';

const SOURCES = {
  'kty-en-en': 'en',
  'en-zh': 'en',
  'kty-ru-en': 'ru',
  'jitendex': 'ja',
  'old-format': undefined
};

function input(over: Partial<DictionarySwitchInput>): DictionarySwitchInput {
  return {
    previousLanguage: null,
    language: 'en',
    dictionaries: Object.keys(SOURCES).map(name => ({name, enabled: false})),
    sourceLanguages: SOURCES,
    memory: {},
    ...over
  };
}

const on = (dictionaries: DictionarySwitchInput['dictionaries'], enabled: boolean[]) =>
  dictionaries.filter((_, i) => enabled[i]).map(d => d.name);

describe('planDictionarySwitches', () => {
  it('a language used for the first time starts with its own dictionaries on', () => {
    const i = input({language: 'en'});
    expect(on(i.dictionaries, planDictionarySwitches(i).enabled)).toEqual(['kty-en-en', 'en-zh']);
    const ja = input({language: 'ja'});
    expect(on(ja.dictionaries, planDictionarySwitches(ja).enabled)).toEqual(['jitendex']);
  });

  it('does not guess the language of a dictionary that declares none: its switch stays as it is', () => {
    const offPlan = planDictionarySwitches(input({language: 'ja'}));
    expect(offPlan.enabled[4]).toBe(false);
    const dictionaries = Object.keys(SOURCES).map(name => ({name, enabled: name === 'old-format'}));
    for (const language of ['ja', 'en', 'ru']) {
      expect(planDictionarySwitches(input({language, dictionaries})).enabled[4]).toBe(true);
    }
  });

  it('uses the language the user gave to an old-format dictionary like a declared one', () => {
    const plan = planDictionarySwitches(input({language: 'en', sourceLanguages: {...SOURCES, 'old-format': 'en'}}));
    expect(plan.enabled[4]).toBe(true);
  });

  it('remembers the switches left for the previous language and brings them back later', () => {
    // English project, the user also switched on the Russian one and switched off en-zh
    const dictionaries = [
      {name: 'kty-en-en', enabled: true},
      {name: 'en-zh', enabled: false},
      {name: 'kty-ru-en', enabled: true},
      {name: 'jitendex', enabled: false},
      {name: 'old-format', enabled: false}
    ];
    const toJa = planDictionarySwitches(input({previousLanguage: 'en', language: 'ja', dictionaries}));
    expect(on(dictionaries, toJa.enabled)).toEqual(['jitendex']);
    expect(toJa.memory['en']).toEqual({'kty-en-en': true, 'en-zh': false, 'kty-ru-en': true, 'jitendex': false, 'old-format': false});

    const jaSwitches = dictionaries.map((d, i) => ({name: d.name, enabled: toJa.enabled[i]}));
    const backToEn = planDictionarySwitches(input({previousLanguage: 'ja', language: 'en', dictionaries: jaSwitches, memory: toJa.memory}));
    expect(on(dictionaries, backToEn.enabled)).toEqual(['kty-en-en', 'kty-ru-en']);
  });

  it('a sync to the same language keeps the switches as they are (closing the settings dialog)', () => {
    const dictionaries = Object.keys(SOURCES).map(name => ({name, enabled: true}));
    const plan = planDictionarySwitches(input({previousLanguage: 'en', language: 'en', dictionaries, memory: {en: {'kty-ru-en': false}}}));
    expect(plan.enabled).toEqual([true, true, true, true, true]);
  });

  it('a dictionary installed after a language was set up starts with the default rule there', () => {
    const memory = {ja: {'jitendex': true, 'old-format': false}};
    const plan = planDictionarySwitches(input({language: 'ja', memory}));
    // kty-en-en, en-zh and kty-ru-en are new for Japanese: off; the remembered ones as remembered
    expect(plan.enabled).toEqual([false, false, false, true, false]);
  });

  it('does not change the memory it was given', () => {
    const memory = {en: {'kty-en-en': false}};
    planDictionarySwitches(input({previousLanguage: 'en', language: 'ja', memory}));
    expect(memory).toEqual({en: {'kty-en-en': false}});
  });
});

describe('forgetDictionarySwitches', () => {
  it('drops the switches of the given dictionaries in every language, so a new answer starts them over', () => {
    const memory = {en: {'old-en-zh': true, 'kty-en-en': true}, ja: {'old-en-zh': true}};
    const forgotten = forgetDictionarySwitches(memory, ['old-en-zh']);
    expect(forgotten).toEqual({en: {'kty-en-en': true}, ja: {}});
    expect(memory.en['old-en-zh']).toBe(true);

    // The next sync to Japanese applies the rule for a dictionary it has not seen: off, it is an English one now
    const plan = planDictionarySwitches(input({
      language: 'ja',
      dictionaries: [{name: 'old-en-zh', enabled: true}],
      sourceLanguages: {'old-en-zh': 'en'},
      memory: forgotten
    }));
    expect(plan.enabled).toEqual([false]);
  });
});

describe('resolveDictionaryLanguages', () => {
  it('takes the declared language first, then the one the user gave, and lists the rest as unknown', () => {
    const resolved = resolveDictionaryLanguages(
      [{title: 'kty-en-en', sourceLanguage: 'en'}, {title: 'old-en-zh'}, {title: 'old-jmdict', sourceLanguage: ''}],
      {'old-en-zh': 'en'}
    );
    expect(resolved.sourceLanguages).toEqual({'kty-en-en': 'en', 'old-en-zh': 'en'});
    expect(resolved.unknown).toEqual(['old-jmdict']);
    expect(resolved.dictionaryLanguages).toEqual({'old-en-zh': 'en'});
  });

  it('forgets answers for dictionaries that are gone (a reinstall asks again) or now declare a language', () => {
    const resolved = resolveDictionaryLanguages([{title: 'updated', sourceLanguage: 'de'}], {'deleted': 'en', 'updated': 'fr'});
    expect(resolved.dictionaryLanguages).toEqual({});
    expect(resolved.sourceLanguages).toEqual({'updated': 'de'});
  });
});

describe('dictionary store file', () => {
  const dirs: string[] = [];
  const tempFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dict-switches-'));
    dirs.push(dir);
    return path.join(dir, 'sub', 'yomitan-dictionary-switches.json');
  };
  afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, {recursive: true, force: true})));

  it('round-trips', () => {
    const file = tempFile();
    const store = {switches: {en: {'kty-en-en': true, 'kty-ru-en': false}}, dictionaryLanguages: {'old-en-zh': 'en'}};
    saveDictionaryStore(file, store);
    expect(loadDictionaryStore(file)).toEqual(store);
  });

  it('starts empty when the file is missing, broken or from an unknown version', () => {
    const empty = {switches: {}, dictionaryLanguages: {}};
    const file = tempFile();
    expect(loadDictionaryStore(file)).toEqual(empty);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, '{not json');
    expect(loadDictionaryStore(file)).toEqual(empty);
    fs.writeFileSync(file, JSON.stringify({version: 2, languages: {en: {a: true}}}));
    expect(loadDictionaryStore(file)).toEqual(empty);
  });

  it('reads a file without dictionary languages, and drops entries of the wrong shape', () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({version: 1, languages: {en: {a: true}, ja: {b: 'yes'}, ru: [true]}}));
    expect(loadDictionaryStore(file)).toEqual({switches: {en: {a: true}}, dictionaryLanguages: {}});
    fs.writeFileSync(file, JSON.stringify({version: 1, languages: {}, dictionaryLanguages: {a: 'en', b: '', c: 3}}));
    expect(loadDictionaryStore(file)).toEqual({switches: {}, dictionaryLanguages: {a: 'en'}});
  });
});
