import {SubtitleData, SubtitlePart} from '../../../shared/types/subtitle.type';

export interface VideoClip {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text?: string;
  hasSubtitle: boolean;
  parts: SubtitlePart[]; // array of all merged parts for simple text rendering
  sourceSubtitles: SubtitleData[]; // The original, un-merged subtitles this clip contains
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
  DeleteClip = 'DeleteClip',
  CreateClip = 'CreateClip',
  ExportToAnki = 'ExportToAnki',
  ZoomIn = 'ZoomIn',
  ZoomOut = 'ZoomOut',
  OpenHelpDialog = 'OpenHelpDialog',
  OpenGlobalSettings = 'OpenGlobalSettings',
  CloseDialogOrEsc = 'CloseDialogOrEsc',
  ConfirmDialog = 'ConfirmDialog',
  AddNote = 'AddNote',
  SwitchToTrack1 = 'SwitchToTrack1',
  SwitchToTrack2 = 'SwitchToTrack2',
  SwitchToTrack3 = 'SwitchToTrack3',
  SwitchToTrack4 = 'SwitchToTrack4',
  SwitchToTrack5 = 'SwitchToTrack5',
  SwitchToTrack6 = 'SwitchToTrack6',
  SwitchToTrack7 = 'SwitchToTrack7',
  SwitchToTrack8 = 'SwitchToTrack8',
  SwitchToTrack9 = 'SwitchToTrack9'
}

export type KeyboardActionKey = keyof typeof KeyboardAction;

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
  AutoPausedAtEnd = 'AutoPausedAtEnd',
  Seeking = 'Seeking'
}

const SUPPORTED_VIDEO_TYPES = [
  // Standard Containers
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv',
  // MPEG Variations
  'mpg', 'mpeg', 'm4v', 'mts', 'm2ts', 'ts', 'vob',
  // Mobile / Legacy / Web
  '3gp', 'ogv', 'divx'
];

const SUPPORTED_AUDIO_TYPES = [
  // Common Music Formats
  'mp3', 'aac', 'wma', 'ogg',
  // High Fidelity / Lossless
  'flac', 'wav', 'aiff', 'alac', 'ape', 'dsd', 'pcm',
  // Audiobooks & Podcasts
  'm4a', 'm4b', 'mka', 'aa', 'aax', 'opus'
];

export const SUPPORTED_MEDIA_TYPES = [
  ...SUPPORTED_VIDEO_TYPES,
  ...SUPPORTED_AUDIO_TYPES
];

export const SUPPORTED_SUBTITLE_TYPES = [
  // Text-based (Most common)
  'srt', 'vtt', 'ssa', 'ass', 'smi', 'sub'
];
