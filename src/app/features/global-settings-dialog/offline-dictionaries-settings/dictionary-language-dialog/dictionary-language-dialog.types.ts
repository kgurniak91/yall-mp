export interface DictionaryLanguageOption {
  /** Shown in the list, e.g. "English (en)" */
  name: string;
  iso: string;
}

export interface DictionaryLanguageEntry {
  /** Title of an installed dictionary that declares no language */
  title: string;
  /** The language the user gave it earlier; null if not given yet */
  language: string | null;
}

export interface DictionaryLanguageDialogData {
  dictionaries: DictionaryLanguageEntry[];
  languages: DictionaryLanguageOption[];
}

/** Dictionary title -> chosen language ISO code; only the dictionaries whose language was given or changed */
export type DictionaryLanguageDialogResult = Record<string, string>;
