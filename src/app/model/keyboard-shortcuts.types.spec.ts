import {ActionType, KEYBOARD_SHORTCUTS, KeyboardShortcutGroup, KeyboardShortcutScope} from './keyboard-shortcuts.types';
import {DEFAULT_GLOBAL_SETTINGS} from './settings.types';
import {KeyboardAction} from './video.types';

describe('timeline toggle', () => {
  it('is shown by default', () => {
    expect(DEFAULT_GLOBAL_SETTINGS.hideTimeline).toBeFalse();
  });

  it('is bound to T as a single-shot project shortcut', () => {
    const shortcuts = KEYBOARD_SHORTCUTS.filter(s => s.action === KeyboardAction.ToggleTimeline);

    expect(shortcuts.length).toBe(1);
    expect(shortcuts[0].key).toBe('t');
    expect(shortcuts[0].displayKeys).toEqual(['T']);
    expect(shortcuts[0].scope).toBe(KeyboardShortcutScope.Project);
    expect(shortcuts[0].type).toBe(ActionType.SingleShot);
    expect(shortcuts[0].group).toBe(KeyboardShortcutGroup.Timeline);
  });

  it('does not share its key with another unmodified shortcut', () => {
    const others = KEYBOARD_SHORTCUTS.filter(s => s.key === 't' && !s.ctrlKey && !s.shiftKey && !s.altKey);

    expect(others.map(s => s.action)).toEqual([KeyboardAction.ToggleTimeline]);
  });
});
