export enum SubtitleBehavior {
  DoNothing = 'DoNothing',
  ForceShow = 'ForceShow',
  ForceHide = 'ForceHide',
}

export enum HiddenSubtitleStyle {
  Hidden = 'Hidden',
  Blurred = 'Blurred'
}

export interface ProjectSettings {
  autoPauseAtStart: boolean;
  autoPauseAtEnd: boolean;
  subtitledClipSpeed: number;
  gapSpeed: number;
  subtitleBehavior: SubtitleBehavior;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  autoPauseAtStart: false,
  autoPauseAtEnd: false,
  subtitledClipSpeed: 1.0,
  gapSpeed: 3.0,
  subtitleBehavior: SubtitleBehavior.DoNothing
};

export interface GlobalSettings {
  boundaryAdjustAmountMs: number;
  seekAmountSeconds: number;
  hiddenSubtitleStyle: HiddenSubtitleStyle;
  defaultProjectSettings: ProjectSettings;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  boundaryAdjustAmountMs: 50,
  seekAmountSeconds: 2,
  hiddenSubtitleStyle: HiddenSubtitleStyle.Blurred,
  defaultProjectSettings: DEFAULT_PROJECT_SETTINGS
};
