import {SupportedLanguage} from './project.types';

export enum SubtitleBehavior {
  DoNothing = 'DoNothing',
  ForceShow = 'ForceShow',
  ForceHide = 'ForceHide',
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
  subtitlesLanguage: 'other'
};

export interface GlobalSettings {
  boundaryAdjustAmountMs: number;
  seekAmountSeconds: number;
  defaultProjectSettings: ProjectSettings;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  boundaryAdjustAmountMs: 50,
  seekAmountSeconds: 2,
  defaultProjectSettings: DEFAULT_PROJECT_SETTINGS
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
