import {effect, inject, Injectable} from '@angular/core';
import {
  ActionType,
  KEYBOARD_SHORTCUTS,
  KeyboardShortcut,
  KeyboardShortcutGroup,
  KeyboardShortcutScope
} from '../../../model/keyboard-shortcuts.types';
import {KeyboardAction} from '../../../model/video.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {ActionPayload} from '../../../features/project-details/services/project-action/project-action.service';

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutsHelperService {
  private readonly globalShortcuts = new Map<string, KeyboardShortcut>();
  private readonly projectShortcuts = new Map<string, KeyboardShortcut>();
  private readonly actionTypeMap = new Map<KeyboardAction, ActionType>();
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private activeShortcuts: KeyboardShortcut[] = [];

  constructor() {
    effect(() => {
      const swapNavigationShortcuts = this.globalSettingsStateService.swapNavigationShortcuts();
      this.buildShortcutMaps(swapNavigationShortcuts);
    });
  }

  public getShortcutForEvent(event: KeyboardEvent, scope: KeyboardShortcutScope): KeyboardShortcut | undefined {
    const map = scope === KeyboardShortcutScope.Global ? this.globalShortcuts : this.projectShortcuts;

    // Try exact match (e.g. Ctrl+Shift+Z)
    const exactKey = this.generateEventKey(event);
    const exactMatch = map.get(exactKey);

    if (exactMatch) {
      return exactMatch;
    }

    // Fallback: If Shift is held (Speed Override), but no Shift-specific shortcut exists, try to match the base key.
    // This allows "ArrowRight" (Seek) to work while holding Shift.
    if (event.shiftKey && event.key.toLowerCase() !== 'shift') {
      const fallbackKey = this.generateEventKey(event, true); // true = ignoreShift
      const fallbackMatch = map.get(fallbackKey);

      // Only allow fallback if the found shortcut doesn't explicitly require Shift
      if (fallbackMatch && !fallbackMatch.shiftKey) {
        return fallbackMatch;
      }
    }

    return undefined;
  }

  public getActionType({action}: ActionPayload): ActionType | undefined {
    return this.actionTypeMap.get(action);
  }

  public getGroupedShortcuts(): { name: KeyboardShortcutGroup; shortcuts: KeyboardShortcut[] }[] {
    const groups = new Map<KeyboardShortcutGroup, KeyboardShortcut[]>();
    for (const shortcut of this.activeShortcuts) {
      if (!groups.has(shortcut.group)) {
        groups.set(shortcut.group, []);
      }
      groups.get(shortcut.group)!.push(shortcut);
    }
    return Array.from(groups.entries()).map(([name, shortcuts]) => ({name, shortcuts}));
  }

  private generateEventKey(event: KeyboardEvent, ignoreShift = false): string {
    const key = event.key.toLowerCase();
    const parts: string[] = [];

    if (event.ctrlKey && key !== 'control') {
      parts.push('ctrl');
    }

    if (!ignoreShift && event.shiftKey && key !== 'shift') {
      parts.push('shift');
    }

    if (event.altKey && key !== 'alt') {
      parts.push('alt');
    }

    parts.push(key);
    return parts.join('-');
  }

  private buildShortcutMaps(swapNavigationShortcuts: boolean): void {
    this.globalShortcuts.clear();
    this.projectShortcuts.clear();
    this.actionTypeMap.clear();
    this.activeShortcuts = [];

    for (const shortcutDef of KEYBOARD_SHORTCUTS) {
      let shortcut = {...shortcutDef};

      if (swapNavigationShortcuts) {
        if (shortcut.action === KeyboardAction.SeekBackward) {
          shortcut.ctrlKey = true;
          shortcut.displayKeys = ['Ctrl', '←'];
        } else if (shortcut.action === KeyboardAction.PreviousSubtitledClip) {
          shortcut.ctrlKey = false;
          shortcut.displayKeys = ['←'];
        } else if (shortcut.action === KeyboardAction.SeekForward) {
          shortcut.ctrlKey = true;
          shortcut.displayKeys = ['Ctrl', '→'];
        } else if (shortcut.action === KeyboardAction.NextSubtitledClip) {
          shortcut.ctrlKey = false;
          shortcut.displayKeys = ['→'];
        }
      }

      this.activeShortcuts.push(shortcut);

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
