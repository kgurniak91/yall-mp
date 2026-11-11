export interface DictionaryLanguageOption {
  /** Shown in the list, e.g. "English (en)" */
  name: string;
  iso: string;
}

export interface DictionaryLanguageDialogData {
  /** Titles of the installed dictionaries that declare no language */
  dictionaries: string[];
  languages: DictionaryLanguageOption[];
}

/** Dictionary title -> chosen language ISO code; only the dictionaries the user answered for */
export type DictionaryLanguageDialogResult = Record<string, string>;
