import {inject, Injectable, OnDestroy} from '@angular/core';
import {ProjectActionService} from '../project-action/project-action.service';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {
  KeyboardShortcutsHelperService
} from '../../../../core/services/keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {ActionType, KeyboardShortcutScope} from '../../../../model/keyboard-shortcuts.types';
import {KeyboardAction} from '../../../../model/video.types';

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
    window.addEventListener('blur', this.handleBlur);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  private readonly handleBlur = (): void => {
    this.activeKeys.clear();
    this.actionService.dispatch(KeyboardAction.ActivateSpeedOverride, false);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const code = event.code;
    if (this.activeKeys.has(code)) {
      this.activeKeys.delete(code);

      // Detect release of the speed override key
      const shortcut = this.keyboardShortcutsHelperService.getShortcutForEvent(event, KeyboardShortcutScope.Project);
      if (shortcut?.action === KeyboardAction.ActivateSpeedOverride) {
        this.actionService.dispatch(shortcut.action, false);
      }
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    // Ignore if user is typing in an input field
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'WEBVIEW' || target.isContentEditable) {
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

    // Handle current notes drawer shortcuts
    if (this.projectSettingsStateService.isNotesDrawerOpen()) {
      if (event.key === 'Escape' || event.key === 'n') {
        event.preventDefault();
        this.projectSettingsStateService.setNotesDrawerOpen(false);
      }

      // Block all other shortcuts when the drawer is open
      return;
    }

    const shortcut = this.keyboardShortcutsHelperService.getShortcutForEvent(event, KeyboardShortcutScope.Project);
    if (!shortcut) {
      return;
    }

    // Special handling for hold-to-activate speed override
    if (shortcut.action === KeyboardAction.ActivateSpeedOverride) {
      // Only dispatch Start event if key wasn't already held down (ignore OS repeats)
      if (!this.activeKeys.has(event.code)) {
        this.activeKeys.add(event.code);
        this.actionService.dispatch(shortcut.action, true); // true = active
      }
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
