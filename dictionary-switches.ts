import * as fs from 'fs';
import * as path from 'path';

// Yomitan keeps a single on/off switch per dictionary. The player changes Yomitan's language with the subtitle language
// of the project, and with it which dictionaries are on: the switches the user left for a language are remembered and
// come back when that language is used again. A language (or a dictionary) without a remembered switch starts with the
// dictionaries of that language on and the others off. A dictionary that does not declare its language (old format) is
// left as it is until the user has said which language it is for; giving it a language (or another one later) forgets
// its remembered switches, so every language starts it over with that rule.

/** Remembered switches: language ISO code -> dictionary title -> on/off. */
export type DictionarySwitchMemory = Record<string, Record<string, boolean>>;

/** Languages the user gave to dictionaries that do not declare one: dictionary title -> language ISO code. */
export type DictionaryLanguages = Record<string, string>;

export interface DictionaryStore {
  switches: DictionarySwitchMemory;
  dictionaryLanguages: DictionaryLanguages;
}

export interface ProfileDictionary {
  name: string;
  enabled: boolean;
}

export interface InstalledDictionary {
  title: string;
  sourceLanguage?: string;
}

export interface DictionarySwitchInput {
  /** Yomitan's language before the change; its current switches are what the user left for it */
  previousLanguage: string | null;
  language: string;
  /** The dictionaries of the Yomitan profile, in profile order */
  dictionaries: ProfileDictionary[];
  /** Dictionary title -> source language (declared, or given by the user); missing when nobody knows it yet */
  sourceLanguages: Record<string, string | undefined>;
  memory: DictionarySwitchMemory;
}

export interface DictionarySwitchPlan {
  memory: DictionarySwitchMemory;
  /** The switch for each dictionary, in the order of `dictionaries` */
  enabled: boolean[];
}

export function planDictionarySwitches(input: DictionarySwitchInput): DictionarySwitchPlan {
  const memory: DictionarySwitchMemory = {...input.memory};
  if (input.previousLanguage) {
    const left: Record<string, boolean> = {...memory[input.previousLanguage]};
    for (const dictionary of input.dictionaries) {
      left[dictionary.name] = dictionary.enabled;
    }
    memory[input.previousLanguage] = left;
  }

  const remembered = memory[input.language] ?? {};
  const enabled = input.dictionaries.map(dictionary => {
    const choice = remembered[dictionary.name];
    if (choice !== undefined) {
      return choice;
    }
    const sourceLanguage = input.sourceLanguages[dictionary.name];
    // First use: on for its own language; an unknown language is not guessed, the switch stays as it is
    return sourceLanguage ? sourceLanguage === input.language : dictionary.enabled;
  });
  return {memory, enabled};
}

/** The memory without the switches of these dictionaries, in every language. */
export function forgetDictionarySwitches(memory: DictionarySwitchMemory, titles: string[]): DictionarySwitchMemory {
  const forgotten: DictionarySwitchMemory = {};
  for (const [language, switches] of Object.entries(memory)) {
    forgotten[language] = Object.fromEntries(Object.entries(switches).filter(([title]) => !titles.includes(title)));
  }
  return forgotten;
}

export interface ResolvedLanguages {
  sourceLanguages: Record<string, string | undefined>;
  /** Installed dictionaries whose language nobody knows yet: the user is asked */
  unknown: string[];
  /** The user's answers, without dictionaries that are gone (a reinstall asks again) or now declare a language */
  dictionaryLanguages: DictionaryLanguages;
}

export function resolveDictionaryLanguages(installed: InstalledDictionary[], given: DictionaryLanguages): ResolvedLanguages {
  const sourceLanguages: Record<string, string | undefined> = {};
  const unknown: string[] = [];
  const dictionaryLanguages: DictionaryLanguages = {};
  for (const {title, sourceLanguage} of installed) {
    if (sourceLanguage) {
      sourceLanguages[title] = sourceLanguage;
    } else if (given[title]) {
      sourceLanguages[title] = given[title];
      dictionaryLanguages[title] = given[title];
    } else {
      unknown.push(title);
    }
  }
  return {sourceLanguages, unknown, dictionaryLanguages};
}

interface StoredFile {
  version: 1;
  languages: DictionarySwitchMemory;
  dictionaryLanguages?: DictionaryLanguages;
}

function isRecordOf<T>(value: unknown, check: (v: unknown) => v is T): value is Record<string, T> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(check);
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Reads the remembered switches and languages; a missing or unreadable file means nothing is remembered yet. */
export function loadDictionaryStore(file: string): DictionaryStore {
  const store: DictionaryStore = {switches: {}, dictionaryLanguages: {}};
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StoredFile>;
    if (!stored || stored.version !== 1) {
      return store;
    }
    if (typeof stored.languages === 'object' && stored.languages !== null) {
      for (const [language, switches] of Object.entries(stored.languages)) {
        if (isRecordOf(switches, isBoolean)) {
          store.switches[language] = {...switches};
        }
      }
    }
    if (typeof stored.dictionaryLanguages === 'object' && stored.dictionaryLanguages !== null) {
      for (const [title, language] of Object.entries(stored.dictionaryLanguages)) {
        if (isNonEmptyString(language)) {
          store.dictionaryLanguages[title] = language;
        }
      }
    }
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.warn(`[DictionarySwitches] Ignoring unreadable ${file}:`, e?.message ?? e);
    }
  }
  return store;
}

export function saveDictionaryStore(file: string, store: DictionaryStore): void {
  const stored: StoredFile = {version: 1, languages: store.switches, dictionaryLanguages: store.dictionaryLanguages};
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(stored, null, 2), 'utf-8');
  fs.renameSync(temp, file);
}
