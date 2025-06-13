export interface VideoClip {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text?: string;
  hasSubtitle: boolean;
}

export enum KeyboardAction {
  ToggleSubtitles = 'ToggleSubtitles',
  SeekBackward = 'SeekBackward',
  SeekForward = 'SeekForward',
  PreviousSubtitleClip = 'PreviousSubtitleClip',
  NextSubtitleClip = 'NextSubtitleClip',
  ToggleRepeatSubtitleClip = 'ToggleRepeatSubtitleClip',
  TogglePlayPause = 'TogglePlayPause',
}

export enum SeekType {
  Absolute = 'Absolute',
  Relative = 'Relative',
}

export enum SeekDirection {
  Previous = 'Previous',
  Next = 'Next',
}
