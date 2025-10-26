import {Injectable} from '@angular/core';
import {
  ActionType,
  KEYBOARD_SHORTCUTS,
  KeyboardShortcut,
  KeyboardShortcutGroup,
  KeyboardShortcutScope
} from '../../../model/keyboard-shortcuts.types';
import {KeyboardAction} from '../../../model/video.types';

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutsHelperService {
  private readonly globalShortcuts = new Map<string, KeyboardShortcut>();
  private readonly projectShortcuts = new Map<string, KeyboardShortcut>();
  private readonly actionTypeMap = new Map<KeyboardAction, ActionType>();

  constructor() {
    this.buildShortcutMaps();
  }

  public getShortcutForEvent(event: KeyboardEvent, scope: KeyboardShortcutScope): KeyboardShortcut | undefined {
    const key = this.generateEventKey(event);
    const map = scope === KeyboardShortcutScope.Global ? this.globalShortcuts : this.projectShortcuts;
    return map.get(key);
  }

  public getActionType(action: KeyboardAction): ActionType | undefined {
    return this.actionTypeMap.get(action);
  }

  public getGroupedShortcuts(): { name: KeyboardShortcutGroup; shortcuts: KeyboardShortcut[] }[] {
    const groups = new Map<KeyboardShortcutGroup, KeyboardShortcut[]>();
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      if (!groups.has(shortcut.group)) {
        groups.set(shortcut.group, []);
      }
      groups.get(shortcut.group)!.push(shortcut);
    }
    return Array.from(groups.entries()).map(([name, shortcuts]) => ({name, shortcuts}));
  }

  private generateEventKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    parts.push(event.key.toLowerCase());
    return parts.join('-');
  }

  private buildShortcutMaps(): void {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const keyParts: string[] = [];
      if (shortcut.ctrlKey) keyParts.push('ctrl');
      if (shortcut.shiftKey) keyParts.push('shift');
      if (shortcut.altKey) keyParts.push('alt');
      keyParts.push(shortcut.key.toLowerCase());
      const key = keyParts.join('-');

      if (shortcut.scope === KeyboardShortcutScope.Global) {
        this.globalShortcuts.set(key, shortcut);
      } else {
        this.projectShortcuts.set(key, shortcut);
      }

      this.actionTypeMap.set(shortcut.action, shortcut.type);
    }
  }
}
