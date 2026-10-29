/** True when the renderer runs on macOS, where the primary shortcut modifier is Command instead of Ctrl. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

/** Whether the primary modifier is held: Ctrl on Windows and Linux, Command on macOS (where Ctrl+click is a right click). */
export function primaryModifierPressed(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>,
  mac: boolean = isMacPlatform()
): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

/** `event.key` of the primary modifier itself. */
export function primaryModifierKey(mac: boolean = isMacPlatform()): 'Control' | 'Meta' {
  return mac ? 'Meta' : 'Control';
}

/** How the primary modifier is written in the UI. */
export function primaryModifierLabel(mac: boolean = isMacPlatform()): string {
  return mac ? '⌘' : 'Ctrl';
}

/** Replaces "Ctrl" with the platform's label in a text such as a tooltip: "Undo (Ctrl+Z)". */
export function localizeModifier(text: string, mac: boolean = isMacPlatform()): string {
  return mac ? text.replace(/\bCtrl\b/g, '⌘') : text;
}
