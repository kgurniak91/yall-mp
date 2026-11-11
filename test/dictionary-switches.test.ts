import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  isOnByDefault,
  loadDictionarySwitchMemory,
  planDictionarySwitches,
  saveDictionarySwitchMemory,
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

describe('isOnByDefault', () => {
  it('matches the source language, and counts a dictionary without one as Japanese', () => {
    expect(isOnByDefault('en', 'en')).toBe(true);
    expect(isOnByDefault('ru', 'en')).toBe(false);
    expect(isOnByDefault(undefined, 'ja')).toBe(true);
    expect(isOnByDefault('', 'en')).toBe(false);
  });
});

describe('planDictionarySwitches', () => {
  it('a language used for the first time starts with its own dictionaries on', () => {
    const i = input({language: 'en'});
    expect(on(i.dictionaries, planDictionarySwitches(i).enabled)).toEqual(['kty-en-en', 'en-zh']);
    const ja = input({language: 'ja'});
    expect(on(ja.dictionaries, planDictionarySwitches(ja).enabled)).toEqual(['jitendex', 'old-format']);
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
    expect(on(dictionaries, toJa.enabled)).toEqual(['jitendex', 'old-format']);
    expect(toJa.memory['en']).toEqual({'kty-en-en': true, 'en-zh': false, 'kty-ru-en': true, 'jitendex': false, 'old-format': false});

    const jaSwitches = dictionaries.map((d, i) => ({name: d.name, enabled: toJa.enabled[i]}));
    const backToEn = planDictionarySwitches(input({previousLanguage: 'ja', language: 'en', dictionaries: jaSwitches, memory: toJa.memory}));
    expect(on(dictionaries, backToEn.enabled)).toEqual(['kty-en-en', 'kty-ru-en']);
  });

  it('a sync to the same language keeps the switches as they are (closing the settings dialog)', () => {
    const dictionaries = [
      {name: 'kty-en-en', enabled: true},
      {name: 'en-zh', enabled: true},
      {name: 'kty-ru-en', enabled: true},
      {name: 'jitendex', enabled: true},
      {name: 'old-format', enabled: true}
    ];
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

describe('dictionary switch memory file', () => {
  const dirs: string[] = [];
  const tempFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dict-switches-'));
    dirs.push(dir);
    return path.join(dir, 'sub', 'yomitan-dictionary-switches.json');
  };
  afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, {recursive: true, force: true})));

  it('round-trips', () => {
    const file = tempFile();
    saveDictionarySwitchMemory(file, {en: {'kty-en-en': true, 'kty-ru-en': false}});
    expect(loadDictionarySwitchMemory(file)).toEqual({en: {'kty-en-en': true, 'kty-ru-en': false}});
  });

  it('starts empty when the file is missing, broken or from an unknown version', () => {
    const file = tempFile();
    expect(loadDictionarySwitchMemory(file)).toEqual({});
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, '{not json');
    expect(loadDictionarySwitchMemory(file)).toEqual({});
    fs.writeFileSync(file, JSON.stringify({version: 2, languages: {en: {a: true}}}));
    expect(loadDictionarySwitchMemory(file)).toEqual({});
  });

  it('drops entries that are not on/off maps', () => {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({version: 1, languages: {en: {a: true}, ja: {b: 'yes'}, ru: [true]}}));
    expect(loadDictionarySwitchMemory(file)).toEqual({en: {a: true}});
  });
});
