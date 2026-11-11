import * as fs from 'fs';
import * as path from 'path';

// Yomitan keeps a single on/off switch per dictionary. The player changes Yomitan's language with the subtitle language
// of the project, and with it which dictionaries are on: the switches the user left for a language are remembered and
// come back when that language is used again. A language (or a dictionary) without a remembered switch starts with the
// dictionaries of that language on and the others off.

/** Remembered switches: language ISO code -> dictionary title -> on/off. */
export type DictionarySwitchMemory = Record<string, Record<string, boolean>>;

export interface ProfileDictionary {
  name: string;
  enabled: boolean;
}

export interface DictionarySwitchInput {
  /** Yomitan's language before the change; its current switches are what the user left for it */
  previousLanguage: string | null;
  language: string;
  /** The dictionaries of the Yomitan profile, in profile order */
  dictionaries: ProfileDictionary[];
  /** Dictionary title -> source language from its index.json (missing in old-format dictionaries) */
  sourceLanguages: Record<string, string | undefined>;
  memory: DictionarySwitchMemory;
}

export interface DictionarySwitchPlan {
  memory: DictionarySwitchMemory;
  /** The switch for each dictionary, in the order of `dictionaries` */
  enabled: boolean[];
}

/** First use of a language: its own dictionaries on. Old-format dictionaries carry no language and count as Japanese. */
export function isOnByDefault(sourceLanguage: string | undefined, language: string): boolean {
  return (sourceLanguage || 'ja') === language;
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
    return choice ?? isOnByDefault(input.sourceLanguages[dictionary.name], input.language);
  });
  return {memory, enabled};
}

interface StoredMemory {
  version: 1;
  languages: DictionarySwitchMemory;
}

function isSwitchMap(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(v => typeof v === 'boolean');
}

/** Reads the remembered switches; a missing or unreadable file means nothing is remembered yet. */
export function loadDictionarySwitchMemory(file: string): DictionarySwitchMemory {
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StoredMemory>;
    const memory: DictionarySwitchMemory = {};
    if (stored && stored.version === 1 && typeof stored.languages === 'object' && stored.languages !== null) {
      for (const [language, switches] of Object.entries(stored.languages)) {
        if (isSwitchMap(switches)) {
          memory[language] = {...switches};
        }
      }
    }
    return memory;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.warn(`[DictionarySwitches] Ignoring unreadable ${file}:`, e?.message ?? e);
    }
    return {};
  }
}

export function saveDictionarySwitchMemory(file: string, memory: DictionarySwitchMemory): void {
  const stored: StoredMemory = {version: 1, languages: memory};
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(stored, null, 2), 'utf-8');
  fs.renameSync(temp, file);
}
