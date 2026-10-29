import {shortcutKeyName} from './shortcut-key';

describe('shortcutKeyName', () => {
  it('uses the character of a Latin layout', () => {
    expect(shortcutKeyName({key: 'a', code: 'KeyA'})).toBe('a');
    expect(shortcutKeyName({key: 'P', code: 'KeyP'})).toBe('p');
    expect(shortcutKeyName({key: ',', code: 'Comma'})).toBe(',');
  });

  it('keeps AZERTY and Dvorak by what their keys say, not by where they are', () => {
    // On AZERTY the "a" sits on the physical Q position, on Dvorak the "p" on the physical R position
    expect(shortcutKeyName({key: 'a', code: 'KeyQ'})).toBe('a');
    expect(shortcutKeyName({key: 'p', code: 'KeyR'})).toBe('p');
  });

  it('uses the physical key for a Cyrillic layout', () => {
    expect(shortcutKeyName({key: 'ф', code: 'KeyA'})).toBe('a');
    expect(shortcutKeyName({key: 'З', code: 'KeyP'})).toBe('p');
    expect(shortcutKeyName({key: 'я', code: 'KeyZ'})).toBe('z');
  });

  it('uses the physical key for other scripts', () => {
    expect(shortcutKeyName({key: 'ש', code: 'KeyA'})).toBe('a');
    expect(shortcutKeyName({key: 'ش', code: 'KeyA'})).toBe('a');
    expect(shortcutKeyName({key: 'α', code: 'KeyA'})).toBe('a');
  });

  it('maps the punctuation keys the shortcuts use', () => {
    expect(shortcutKeyName({key: 'б', code: 'Comma'})).toBe(',');
    expect(shortcutKeyName({key: 'ю', code: 'Period'})).toBe('.');
    expect(shortcutKeyName({key: 'х', code: 'BracketLeft'})).toBe('[');
    expect(shortcutKeyName({key: 'ъ', code: 'BracketRight'})).toBe(']');
    expect(shortcutKeyName({key: 'ё', code: 'Backquote'})).toBe('`');
  });

  it('resolves a dead key by its physical key', () => {
    expect(shortcutKeyName({key: 'Dead', code: 'Backquote'})).toBe('`');
  });

  it('leaves named keys alone', () => {
    expect(shortcutKeyName({key: 'ArrowLeft', code: 'ArrowLeft'})).toBe('arrowleft');
    expect(shortcutKeyName({key: 'Control', code: 'ControlLeft'})).toBe('control');
    expect(shortcutKeyName({key: ' ', code: 'Space'})).toBe(' ');
    expect(shortcutKeyName({key: 'F11', code: 'F11'})).toBe('f11');
  });

  it('falls back to the character when the physical key is not one a shortcut can be bound to', () => {
    expect(shortcutKeyName({key: 'é', code: 'IntlBackslash'})).toBe('é');
  });
});
