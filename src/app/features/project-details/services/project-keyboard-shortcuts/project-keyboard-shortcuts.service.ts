import {inject, Injectable, OnDestroy} from '@angular/core';
import {ProjectActionService} from '../project-action/project-action.service';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {
  KeyboardShortcutsHelperService
} from '../../../../core/services/keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {ActionType, KeyboardShortcutScope} from '../../../../model/keyboard-shortcuts.types';

@Injectable()
export class ProjectKeyboardShortcutsService implements OnDestroy {
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly actionService = inject(ProjectActionService);
  private readonly keyboardShortcutsHelperService = inject(KeyboardShortcutsHelperService);
  // Tracks keys currently held down to prevent OS key-repeat from firing single-shot actions multiple times:
  private activeKeys = new Set<string>();

  constructor() {
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.activeKeys.delete(event.code);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    // Ignore if user is typing in an input field
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Handle current settings drawer shortcuts first
    if (this.projectSettingsStateService.isSettingsDrawerOpen()) {
      if (event.key === 'Escape' || event.key === 'p') {
        event.preventDefault();
        this.projectSettingsStateService.setSettingsDrawerOpen(false);
      }

      // Block all other shortcuts when the drawer is open
      return;
    }

    const shortcut = this.keyboardShortcutsHelperService.getShortcutForEvent(event, KeyboardShortcutScope.Project);
    if (!shortcut) {
      return;
    }

    // If it's a single-shot action (like Play/Pause), only dispatch if the key isn't already registered as down.
    if (shortcut.type === ActionType.SingleShot) {
      if (this.activeKeys.has(event.code)) {
        event.preventDefault(); // Prevent default browser behavior on repeat
        return; // Ignore OS key repeat
      }
      this.activeKeys.add(event.code);
    }

    // Dispatch the action.
    // For single-shot, this happens once per press.
    // For continuous, this happens on every OS key repeat, and ProjectActionService throttles it.
    event.preventDefault();
    this.actionService.dispatch(shortcut.action);
  };
}
