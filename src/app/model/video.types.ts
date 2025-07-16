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
  PreviousSubtitledClip = 'PreviousSubtitledClip',
  NextSubtitledClip = 'NextSubtitledClip',
  RepeatCurrentClip = 'RepeatCurrentClip',
  ForceContinue = 'ForceContinue',
  TogglePlayPause = 'TogglePlayPause',
  AdjustClipStartLeft = 'AdjustClipStartLeft',
  AdjustClipStartRight = 'AdjustClipStartRight',
  AdjustClipEndLeft = 'AdjustClipEndLeft',
  AdjustClipEndRight = 'AdjustClipEndRight',
  ToggleSettings = 'ToggleSettings',
  EditCurrentSubtitles = 'EditCurrentSubtitles',
  Undo = 'Undo',
  Redo = 'Redo',
  SplitClip = 'SplitClip',
  DeleteGap = 'DeleteGap'
}

export enum SeekType {
  Absolute = 'Absolute',
  Relative = 'Relative',
}

export enum SeekDirection {
  Previous = 'Previous',
  Next = 'Next',
}

export enum VideoPlayerAction {
  Play = 'Play',
  Pause = 'Pause'
}

export enum PlayerState {
  Idle = 'Idle',
  Playing = 'Playing',
  PausedByUser = 'PausedByUser',
  AutoPausedAtStart = 'AutoPausedAtStart',
  AutoPausedAtEnd = 'AutoPausedAtEnd'
}

export interface PlayCommand {
  action: VideoPlayerAction.Play;
  clip: VideoClip;
  seekToTime?: number;
  playbackRate: number; // If present, seek to this time, otherwise resume from current.
}

export interface PauseCommand {
  action: VideoPlayerAction.Pause;
  clip: VideoClip;
  seekToTime?: number; // Seek to a time, then pause.
}

export type VideoPlayerCommand = PlayCommand | PauseCommand;

export const SUPPORTED_MEDIA_TYPES = ['mp4', 'mkv', 'webm', 'mov', 'avi'];
export const SUPPORTED_SUBTITLE_TYPES = ['vtt', 'srt', 'ssa', 'ass'];
