const PUNCTUATION_BY_CODE: Readonly<Record<string, string>> = {
  Comma: ',',
  Period: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Slash: '/',
  Semicolon: ';',
  Quote: '\''
};

/** The Latin letter, digit or punctuation mark on the same physical key of a US layout, if there is one. */
function fromPhysicalKey(code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    return letter[1].toLowerCase();
  }
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    return digit[1];
  }
  return PUNCTUATION_BY_CODE[code];
}

/**
 * The name a shortcut is bound to for a key event, lower case: `a`, `ctrl`, `arrowleft`, `[`. With a Latin layout this is
 * the character the key produces (so AZERTY and Dvorak keep working by what their keys say). With any other layout
 * (Cyrillic, Greek, Hebrew, Arabic, ...) the character says nothing about which shortcut was meant, so the physical key
 * decides: the key that types "ф" on a Russian layout is the "a" key.
 */
export function shortcutKeyName(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const key = event.key;
  const isNonLatinCharacter = [...key].length === 1 && key.charCodeAt(0) > 127;
  if (isNonLatinCharacter || key === 'Dead') {
    const physical = fromPhysicalKey(event.code);
    if (physical) {
      return physical;
    }
  }
  return key.toLowerCase();
}
