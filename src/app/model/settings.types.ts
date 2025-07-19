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
  adjustValueMs: number;
  seekSeconds: number;
  hiddenSubtitleStyle: HiddenSubtitleStyle;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  autoPauseAtStart: false,
  autoPauseAtEnd: false,
  subtitledClipSpeed: 1.0,
  gapSpeed: 3.0,
  subtitleBehavior: SubtitleBehavior.DoNothing,
  adjustValueMs: 50,
  seekSeconds: 2,
  hiddenSubtitleStyle: HiddenSubtitleStyle.Blurred,
};
