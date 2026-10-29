import {localizeModifier, primaryModifierKey, primaryModifierLabel, primaryModifierPressed} from './primary-modifier';

describe('primary modifier', () => {
  it('is Ctrl on Windows and Linux and ignores Command there', () => {
    expect(primaryModifierPressed({ctrlKey: true, metaKey: false}, false)).toBeTrue();
    expect(primaryModifierPressed({ctrlKey: false, metaKey: true}, false)).toBeFalse();
    expect(primaryModifierKey(false)).toBe('Control');
    expect(primaryModifierLabel(false)).toBe('Ctrl');
  });

  it('is Command on macOS and ignores Ctrl there', () => {
    expect(primaryModifierPressed({ctrlKey: false, metaKey: true}, true)).toBeTrue();
    expect(primaryModifierPressed({ctrlKey: true, metaKey: false}, true)).toBeFalse();
    expect(primaryModifierKey(true)).toBe('Meta');
    expect(primaryModifierLabel(true)).toBe('⌘');
  });

  it('rewrites Ctrl in UI texts only on macOS', () => {
    expect(localizeModifier('Undo (Ctrl+Z)', false)).toBe('Undo (Ctrl+Z)');
    expect(localizeModifier('Undo (Ctrl+Z)', true)).toBe('Undo (⌘+Z)');
    expect(localizeModifier('Play next (Ctrl + →)', true)).toBe('Play next (⌘ + →)');
  });
});
