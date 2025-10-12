import {SupportedLanguage} from './project.types';

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
  gapSpeed: 3.0,
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
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  boundaryAdjustAmountMs: 50,
  seekAmountSeconds: 2,
  defaultProjectSettings: DEFAULT_PROJECT_SETTINGS,
  srtFontSizePx: 28,
  srtBackgroundOpacity: 0.3,
  subtitleLookupServices: [
    {
      id: 'brave',
      name: 'Brave Search',
      urlTemplate: 'https://search.brave.com/search?q=%%SS&source=web',
      isDefault: true,
      browserType: null
    },
    {
      id: 'google',
      name: 'Google Search',
      urlTemplate: 'https://www.google.com/search?q=%%SS',
      isDefault: false,
      browserType: SubtitleLookupBrowserType.System
    },
    {
      id: 'wikipedia',
      name: 'Wikipedia',
      urlTemplate: 'https://en.wikipedia.org/wiki/Special:Search?search=%%SS',
      isDefault: false,
      browserType: null
    },
    {
      id: 'oxford',
      name: 'Oxford Learner\'s Dictionaries',
      urlTemplate: 'https://www.oxfordlearnersdictionaries.com/us/definition/english/%%SS',
      isDefault: false,
      browserType: null
    },
    {
      id: 'forvo-en',
      name: 'Forvo (English pronunciation)',
      urlTemplate: 'https://forvo.com/word/%%SS/#en',
      isDefault: false,
      browserType: null
    },
    {
      id: 'deepl-es',
      name: 'DeepL (American to Spanish translation)',
      urlTemplate: 'www.deepl.com/en/translator#en-us/es/%%SS',
      isDefault: false,
      browserType: null
    }
  ],
  subtitleLookupBrowserType: SubtitleLookupBrowserType.BuiltIn
};

export interface SettingsPreset {
  name: string;
  settings: Partial<ProjectSettings>;
}

export const ListeningPracticeSettingsPreset: SettingsPreset = {
  name: 'Listening Practice',
  settings: {
    autoPauseAtStart: false,
    autoPauseAtEnd: true,
    subtitleBehavior: SubtitleBehavior.ForceHide
  }
};

export const SpeakingPracticeSettingsPreset: SettingsPreset = {
  name: 'Speaking Practice',
  settings: {
    autoPauseAtStart: true,
    autoPauseAtEnd: false,
    subtitleBehavior: SubtitleBehavior.ForceShow
  }
};

export const BuiltInSettingsPresets: SettingsPreset[] = [
  ListeningPracticeSettingsPreset,
  SpeakingPracticeSettingsPreset
];

export interface SubtitleLookupService {
  id: string;
  name: string;
  urlTemplate: string; // e.g., "https://www.google.com/search?q=%%SS"
  isDefault: boolean;
  browserType: SubtitleLookupBrowserType | null;
}
