import {KeyboardAction} from '../../../../model/video.types';

// Actions that trigger once per press/click
export const SINGLE_SHOT_ACTIONS = new Set<KeyboardAction>([
  KeyboardAction.TogglePlayPause,
  KeyboardAction.ToggleSubtitles,
  KeyboardAction.RepeatCurrentClip,
  KeyboardAction.ForceContinue,
  KeyboardAction.ToggleSettings,
  KeyboardAction.EditCurrentSubtitles,
  KeyboardAction.Undo,
  KeyboardAction.Redo,
  KeyboardAction.SplitClip,
  KeyboardAction.DeleteClip,
  KeyboardAction.CreateClip,
  KeyboardAction.ExportToAnki
]);

// Actions that can be triggered continuously (holding key or rapid clicking)
export const CONTINUOUS_ACTIONS = new Set<KeyboardAction>([
  KeyboardAction.SeekBackward,
  KeyboardAction.SeekForward,
  KeyboardAction.PreviousSubtitledClip,
  KeyboardAction.NextSubtitledClip,
  KeyboardAction.AdjustClipStartLeft,
  KeyboardAction.AdjustClipStartRight,
  KeyboardAction.AdjustClipEndLeft,
  KeyboardAction.AdjustClipEndRight
]);
