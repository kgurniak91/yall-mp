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

export interface ProjectSettings {
  autoPauseAtStart: boolean;
  autoPauseAtEnd: boolean;
  subtitledClipSpeed: number;
  gapSpeed: number;
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
  warnUnexportedNotes: boolean;
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
  warnUnexportedNotes: true
};

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
