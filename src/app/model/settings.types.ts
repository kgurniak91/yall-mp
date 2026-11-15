import {SupportedLanguage} from './project.types';

export type LookupType = 'search' | 'ai';

export enum SubtitleBehavior {
  DoNothing = 'DoNothing',
  ForceShow = 'ForceShow',
  ForceHide = 'ForceHide',
}

export enum SubtitleLookupBrowserType {
  BuiltIn = 'BuiltIn',
  System = 'System'
}

export type AppTheme = 'system' | 'light' | 'dark';

export interface ProjectSettings {
  autoPauseAtStart: boolean;
  autoPauseAtEnd: boolean;
  subtitledClipSpeed: number;
  gapSpeed: number;
  skipGaps: boolean;
  speedOverride: number;
  subtitleBehavior: SubtitleBehavior;
  selectedAudioTrackIndex: number | null;
  useMpvSubtitles: boolean;
  assScale: number;
  assScalePercentage: number;
  subtitlesVisible: boolean;
  subtitlesLanguage: SupportedLanguage;
  defaultSubtitleLookupServiceId: string | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  autoPauseAtStart: false,
  autoPauseAtEnd: false,
  subtitledClipSpeed: 1.0,
  gapSpeed: 2.0,
  skipGaps: false,
  speedOverride: 0.5,
  subtitleBehavior: SubtitleBehavior.DoNothing,
  selectedAudioTrackIndex: null,
  useMpvSubtitles: false,
  assScale: 1.0,
  assScalePercentage: 100.00,
  subtitlesVisible: true,
  subtitlesLanguage: 'other',
  defaultSubtitleLookupServiceId: null
};

export interface GlobalSettings {
  boundaryAdjustAmountMs: number;
  seekAmountSeconds: number;
  defaultProjectSettings: ProjectSettings;
  srtFontSizePx: number;
  srtBackgroundOpacity: number;
  subtitleLookupServices: SubtitleLookupService[];
  subtitleLookupBrowserType: SubtitleLookupBrowserType;
  ankiSuspendNewCardsByDefault: boolean;
  ankiInstantExport: boolean;
  generateAudioPeaks: boolean;
  swapNavigationShortcuts: boolean;
  migratedDefaultAiServices?: boolean; // Flag set only once when migrating from older versions to v0.9.3-beta
  hardwareAcceleration: boolean;
  /** true: the picture reaches the screen over the GPU where that works and falls back to readback; false: always readback. Missing in older settings files means true. */
  gpuVideoPath?: boolean;
  warnUnexportedNotes: boolean;
  preferredAudioLanguages: string[]; // Array of ISO codes (e.g., ['ja', 'en'])
  preferredSubtitleLanguages: string[]; // Array of ISO codes (e.g., ['ja', 'en'])
  volume?: number;
  isMuted?: boolean;
  cinemaModeEnabled: boolean;
  cinemaModeSpeed: number;
  hideTimeline: boolean;
  pauseOnSubtitleHover: boolean;
  customLibmpvPath?: string;
  customFfmpegPath?: string;
  customFfprobePath?: string;
  customAudiowaveformPath?: string;
  theme?: AppTheme;
  /** Missing in settings files from before 0.9.10: the defaults apply (see `normaliseWordColouring`). */
  wordColouring?: WordColouringSettings;
}

/** What a noun with two genders in one meaning (French "artiste") looks like: dotted underline, the first gender, or plain. */
export type WordColouringAmbiguous = 'mark' | 'first' | 'skip';

/** Colouring of nouns (and their articles) by grammatical gender, read from Yomitan dictionary tags. */
export interface WordColouringSettings {
  enabled: boolean;
  /** Yomitan language codes (subtitle languages) the colouring runs for; any other language is never looked up. */
  languages: string[];
  colors: { masculine: string; feminine: string; neuter: string };
  articles: boolean;
  ambiguous: WordColouringAmbiguous;
  /** Tag names the dictionaries use; the defaults are those of the wty-* and kty-* dictionaries. */
  tags: { masculine: string[]; feminine: string[]; neuter: string[]; noun: string[] };
}

/** The languages checked against real wty-/kty- dictionaries (test/word-gender.test.ts). */
export const DEFAULT_WORD_COLOURING_LANGUAGES = ['de', 'fr', 'es', 'it', 'pt', 'ru', 'pl'];

export const DEFAULT_WORD_COLOURING: WordColouringSettings = {
  enabled: false,
  languages: DEFAULT_WORD_COLOURING_LANGUAGES,
  colors: {masculine: '#4da3ff', feminine: '#ff6b9d', neuter: '#5fd068'},
  articles: true,
  ambiguous: 'mark',
  tags: {masculine: ['masc'], feminine: ['fem'], neuter: ['neut'], noun: ['n']}
};

/** True when words of this (Yomitan) language are coloured: colouring on and the language in the user's list. */
export function wordColouringActiveFor(settings: WordColouringSettings, language: string | null | undefined): boolean {
  return settings.enabled && !!language && settings.languages.includes(language.toLowerCase());
}

/** The toast after Ctrl+Shift+G; says so when the language being watched is not in the list. */
export function wordColouringToggleMessage(settings: WordColouringSettings, language: string | null | undefined, languageName?: string): string {
  if (!settings.enabled) {
    return 'Word colours off';
  }
  if (language && !wordColouringActiveFor(settings, language)) {
    return `Word colours on, but not for ${languageName || language}: add it in Global Settings, Word Colouring`;
  }
  return 'Word colours on';
}

/** Fills what an older or hand-edited settings file lacks; an empty tag list falls back to the default names. */
export function normaliseWordColouring(value: Partial<WordColouringSettings> | null | undefined): WordColouringSettings {
  const d = DEFAULT_WORD_COLOURING;
  const v = value ?? {};
  const list = (l: unknown, fallback: string[]): string[] => {
    const clean = Array.isArray(l) ? l.map(x => String(x).trim()).filter(x => x.length > 0) : [];
    return clean.length > 0 ? clean : [...fallback];
  };
  const color = (c: unknown, fallback: string): string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
  // An empty list is kept: the user removed every language
  const languages = Array.isArray(v.languages)
    ? [...new Set(v.languages.map(x => String(x).trim().toLowerCase()).filter(x => x.length > 0))]
    : [...d.languages];
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    languages,
    colors: {
      masculine: color(v.colors?.masculine, d.colors.masculine),
      feminine: color(v.colors?.feminine, d.colors.feminine),
      neuter: color(v.colors?.neuter, d.colors.neuter)
    },
    articles: typeof v.articles === 'boolean' ? v.articles : d.articles,
    ambiguous: v.ambiguous === 'first' || v.ambiguous === 'skip' || v.ambiguous === 'mark' ? v.ambiguous : d.ambiguous,
    tags: {
      masculine: list(v.tags?.masculine, d.tags.masculine),
      feminine: list(v.tags?.feminine, d.tags.feminine),
      neuter: list(v.tags?.neuter, d.tags.neuter),
      noun: list(v.tags?.noun, d.tags.noun)
    }
  };
}

const DEFAULT_SEARCH_SUBTITLE_LOOKUP_SERVICES: SubtitleLookupService[] = [
  {
    id: 'brave',
    name: 'Brave Search',
    urlTemplate: 'https://search.brave.com/search?q=%%SS&source=web',
    isDefault: true,
    browserType: null,
    type: 'search'
  },
  {
    id: 'google',
    name: 'Google Search',
    urlTemplate: 'https://www.google.com/search?q=%%SS',
    isDefault: false,
    browserType: SubtitleLookupBrowserType.System,
    type: 'search'
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    urlTemplate: 'https://en.wikipedia.org/wiki/Special:Search?search=%%SS',
    isDefault: false,
    browserType: null,
    type: 'search'
  },
  {
    id: 'oxford',
    name: 'Oxford Learner\'s Dictionaries',
    urlTemplate: 'https://www.oxfordlearnersdictionaries.com/us/definition/english/%%SS',
    isDefault: false,
    browserType: null,
    type: 'search'
  },
  {
    id: 'forvo-en',
    name: 'Forvo (English pronunciation)',
    urlTemplate: 'https://forvo.com/word/%%SS/#en',
    isDefault: false,
    browserType: null,
    type: 'search'
  }
];

export const DEFAULT_AI_SUBTITLE_LOOKUP_SERVICES: SubtitleLookupService[] = [
  {
    id: 'deepl-pl',
    name: 'DeepL (English to Polish translation)',
    urlTemplate: 'https://www.deepl.com/en/translator/l/en/pl',
    isDefault: false,
    browserType: null,
    type: 'ai',
    aiPrePrompt: ''
  },
  {
    id: 'gemini',
    name: 'Gemini AI (Explain)',
    urlTemplate: 'https://gemini.google.com/app',
    isDefault: false,
    browserType: null,
    type: 'ai',
    aiPrePrompt: 'Explain the grammar and nuance of this sentence: '
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT (Analyze)',
    urlTemplate: 'https://chatgpt.com/',
    isDefault: false,
    browserType: null,
    type: 'ai',
    aiPrePrompt: 'Analyze this text: '
  }
];

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  boundaryAdjustAmountMs: 50,
  seekAmountSeconds: 2,
  defaultProjectSettings: DEFAULT_PROJECT_SETTINGS,
  srtFontSizePx: 28,
  srtBackgroundOpacity: 0.3,
  subtitleLookupServices: [
    ...DEFAULT_SEARCH_SUBTITLE_LOOKUP_SERVICES,
    ...DEFAULT_AI_SUBTITLE_LOOKUP_SERVICES
  ],
  subtitleLookupBrowserType: SubtitleLookupBrowserType.BuiltIn,
  ankiSuspendNewCardsByDefault: false,
  ankiInstantExport: false,
  generateAudioPeaks: false,
  swapNavigationShortcuts: false,
  migratedDefaultAiServices: true, // Set initially to true so new installations don't trigger migration
  hardwareAcceleration: false,
  gpuVideoPath: true,
  warnUnexportedNotes: true,
  preferredAudioLanguages: [],
  preferredSubtitleLanguages: [],
  volume: 100,
  isMuted: false,
  cinemaModeEnabled: false,
  cinemaModeSpeed: 1.0,
  hideTimeline: false,
  pauseOnSubtitleHover: false,
  customLibmpvPath: '',
  customFfmpegPath: '',
  customFfprobePath: '',
  customAudiowaveformPath: '',
  theme: 'system',
  wordColouring: DEFAULT_WORD_COLOURING
};

export enum CustomPath {
  customLibmpvPath = 'libmpv library',
  customFfmpegPath = 'FFmpeg',
  customFfprobePath = 'FFprobe',
  customAudiowaveformPath = 'Audiowaveform',
}

export type CustomPathKey = keyof typeof CustomPath;

export enum BuiltInSettingsPreset {
  CONTINUOUS = 'CONTINUOUS',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  SHADOWING = 'SHADOWING'
}

export interface SettingsPreset {
  id: string;
  name: string;
  settings: Partial<ProjectSettings>;
}

export const ContinuousPlaybackSettingsPreset: SettingsPreset = {
  id: BuiltInSettingsPreset.CONTINUOUS,
  name: 'Continuous Playback',
  settings: {
    autoPauseAtStart: false,
    autoPauseAtEnd: false,
    subtitleBehavior: SubtitleBehavior.DoNothing
  }
};

export const ListeningPracticeSettingsPreset: SettingsPreset = {
  id: BuiltInSettingsPreset.LISTENING,
  name: 'Listening Practice',
  settings: {
    autoPauseAtStart: false,
    autoPauseAtEnd: true,
    subtitleBehavior: SubtitleBehavior.ForceHide
  }
};

export const SpeakingPracticeSettingsPreset: SettingsPreset = {
  id: BuiltInSettingsPreset.SPEAKING,
  name: 'Speaking Practice',
  settings: {
    autoPauseAtStart: true,
    autoPauseAtEnd: true,
    subtitleBehavior: SubtitleBehavior.ForceShow
  }
};

export const ShadowingSettingsPreset: SettingsPreset = {
  id: BuiltInSettingsPreset.SHADOWING,
  name: 'Shadowing',
  settings: {
    autoPauseAtStart: false,
    autoPauseAtEnd: true,
    subtitleBehavior: SubtitleBehavior.ForceShow
  }
};

export const BuiltInSettingsPresets: SettingsPreset[] = [
  ContinuousPlaybackSettingsPreset,
  ListeningPracticeSettingsPreset,
  SpeakingPracticeSettingsPreset,
  ShadowingSettingsPreset
];

export interface SubtitleLookupService {
  id: string;
  name: string;
  urlTemplate: string; // e.g., "https://www.google.com/search?q=%%SS"
  isDefault: boolean;
  browserType: SubtitleLookupBrowserType | null;
  type: LookupType;
  aiPrePrompt?: string;
}
