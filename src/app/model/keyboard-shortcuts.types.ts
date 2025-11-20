import {KeyboardAction, KeyboardActionKey} from "./video.types";

export enum KeyboardShortcutGroup {
  Global = 'Global Dialogs & Windows',
  Playback = 'Playback Control',
  Timeline = 'Timeline Editing',
  Subtitles = 'Subtitles & Integration',
  Application = 'Application & History',
  Tracks = 'Subtitle Tracks'
}

export enum KeyboardShortcutScope {
  Global,
  Project,
}

export enum ActionType {
  SingleShot,
  Continuous,
  Instant
}

export interface KeyboardShortcut {
  action: KeyboardAction;
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  displayKeys: string[];
  scope: KeyboardShortcutScope;
  type: ActionType;
  group: KeyboardShortcutGroup;
}

const SWITCH_TRACK_SHORTCUTS: KeyboardShortcut[] = Array(9).fill(null).map((_, index: number) => {
  const key = `${index + 1}`;
  return {
    action: KeyboardAction[`SwitchToTrack${key}` as KeyboardActionKey],
    key,
    description: `Switch subtitle track to ${key}`,
    displayKeys: [key],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Instant,
    group: KeyboardShortcutGroup.Tracks
  };
});

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // --- Global Scope
  {
    action: KeyboardAction.OpenHelpDialog,
    key: 'F1',
    description: 'Open this Help & About dialog',
    displayKeys: ['F1'],
    scope: KeyboardShortcutScope.Global,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Global
  },
  {
    action: KeyboardAction.OpenGlobalSettings,
    key: 'o',
    description: 'Open Global Settings',
    displayKeys: ['O'],
    scope: KeyboardShortcutScope.Global,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Global
  },
  {
    action: KeyboardAction.CloseDialogOrEsc,
    key: 'Escape',
    description: 'Close active dialog, exit fullscreen, or minimize',
    displayKeys: ['Esc'],
    scope: KeyboardShortcutScope.Global,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Global
  },
  {
    action: KeyboardAction.ConfirmDialog,
    key: 'Enter',
    description: 'Confirm action in dialogs (e.g., Save, Delete)',
    displayKeys: ['Enter'],
    scope: KeyboardShortcutScope.Global,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Global
  },
  {
    action: KeyboardAction.AddNote,
    key: 'S',
    shiftKey: true,
    ctrlKey: true,
    description: 'Add selected text to Anki lookup notes (in built-in browser after clicking on subtitles)',
    displayKeys: ['Ctrl', 'Shift', 'S'],
    scope: KeyboardShortcutScope.Global,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Subtitles
  },
  // --- Project Scope - Playback
  {
    action: KeyboardAction.TogglePlayPause,
    key: ' ',
    description: 'Toggle Play/Pause',
    displayKeys: ['Space'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.SeekBackward,
    key: 'ArrowLeft',
    description: 'Seek backward',
    displayKeys: ['←'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.SeekForward,
    key: 'ArrowRight',
    description: 'Seek forward',
    displayKeys: ['→'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.NextSubtitledClip,
    key: 'ArrowRight',
    ctrlKey: true,
    description: 'Go to next subtitled clip',
    displayKeys: ['Ctrl', '→'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.PreviousSubtitledClip,
    key: 'ArrowLeft',
    ctrlKey: true,
    description: 'Go to previous subtitled clip',
    displayKeys: ['Ctrl', '←'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.RepeatCurrentClip,
    key: 'ArrowUp',
    description: 'Repeat current clip',
    displayKeys: ['↑'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.RepeatCurrentClip,
    key: 'ArrowUp',
    ctrlKey: true,
    description: 'Repeat current clip (alternative)',
    displayKeys: ['Ctrl', '↑'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.ForceContinue,
    key: 'ArrowDown',
    description: 'Force continue playback from auto-pause',
    displayKeys: ['↓'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.ForceContinue,
    key: 'ArrowDown',
    ctrlKey: true,
    description: 'Force continue playback from auto-pause (alternative)',
    displayKeys: ['Ctrl', '↓'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.PreviousMediaFile,
    key: ',',
    ctrlKey: true,
    description: 'Go to previous media file',
    displayKeys: ['Ctrl', ','],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  {
    action: KeyboardAction.NextMediaFile,
    key: '.',
    ctrlKey: true,
    description: 'Go to next media file',
    displayKeys: ['Ctrl', '.'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Playback
  },
  // --- Project Scope - Timeline
  {
    action: KeyboardAction.AdjustClipStartLeft,
    key: '[',
    description: 'Adjust clip start time to the left',
    displayKeys: ['['],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.AdjustClipStartRight,
    key: '[',
    ctrlKey: true,
    description: 'Adjust clip start time to the right',
    displayKeys: ['Ctrl', '['],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.AdjustClipEndRight,
    key: ']',
    description: 'Adjust clip end time to the right',
    displayKeys: [']'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.AdjustClipEndLeft,
    key: ']',
    ctrlKey: true,
    description: 'Adjust clip end time to the left',
    displayKeys: ['Ctrl', ']'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.SplitClip,
    key: '\\',
    description: 'Split subtitled clip at playhead',
    displayKeys: ['\\'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.DeleteClip,
    key: 'Delete',
    description: 'Delete current clip (or merge gap)',
    displayKeys: ['Delete'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.CreateClip,
    key: 'Insert',
    description: 'Create new subtitled clip in a gap',
    displayKeys: ['Insert'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.ZoomOut,
    key: '-',
    description: 'Zoom out timeline',
    displayKeys: ['-'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  {
    action: KeyboardAction.ZoomIn,
    key: '=',
    description: 'Zoom in timeline',
    displayKeys: ['='],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.Continuous,
    group: KeyboardShortcutGroup.Timeline
  },
  // --- Project Scope - Subtitles & Integration
  {
    action: KeyboardAction.ToggleSubtitles,
    key: 'c',
    description: 'Toggle subtitles visibility',
    displayKeys: ['C'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Subtitles
  },
  {
    action: KeyboardAction.EditCurrentSubtitles,
    key: 's',
    description: 'Edit current subtitles text',
    displayKeys: ['S'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Subtitles
  },
  {
    action: KeyboardAction.ExportToAnki,
    key: 'e',
    description: 'Export current clip to Anki',
    displayKeys: ['E'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Subtitles
  },
  // --- Project Scope - Application
  {
    action: KeyboardAction.ToggleSettings,
    key: 'p',
    description: 'Toggle project settings panel',
    displayKeys: ['P'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Application
  },
  {
    action: KeyboardAction.Undo,
    key: 'z',
    ctrlKey: true,
    description: 'Undo last action',
    displayKeys: ['Ctrl', 'Z'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Application
  },
  {
    action: KeyboardAction.Redo,
    key: 'y',
    ctrlKey: true,
    description: 'Redo last action',
    displayKeys: ['Ctrl', 'Y'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Application
  },
  {
    action: KeyboardAction.Redo,
    key: 'z',
    ctrlKey: true,
    shiftKey: true,
    description: 'Redo last action (alternative)',
    displayKeys: ['Ctrl', 'Shift', 'Z'],
    scope: KeyboardShortcutScope.Project,
    type: ActionType.SingleShot,
    group: KeyboardShortcutGroup.Application
  },
  // --- Subtitle Tracks
  ...SWITCH_TRACK_SHORTCUTS
];
