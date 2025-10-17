import {inject, Injectable, OnDestroy} from '@angular/core';
import {KeyboardAction} from '../../../../model/video.types';
import {ProjectActionService} from '../project-action/project-action.service';
import {SINGLE_SHOT_ACTIONS} from '../project-action/project-action.types';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';

@Injectable()
export class ProjectKeyboardShortcutsService implements OnDestroy {
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly actionService = inject(ProjectActionService);
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
      if (event.key === 'Escape' || event.key === ',') {
        event.preventDefault();
        this.projectSettingsStateService.setSettingsDrawerOpen(false);
      }

      // Block all other shortcuts when the drawer is open
      return;
    }

    const action = this.mapEventToAction(event);
    if (!action) {
      return;
    }

    // If it's a single-shot action (like Play/Pause), only dispatch if the key isn't already registered as down.
    if (SINGLE_SHOT_ACTIONS.has(action)) {
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
    this.actionService.dispatch(action);
  };

  private mapEventToAction(event: KeyboardEvent): KeyboardAction | undefined {
    const key = event.key;
    const lowerKey = key.toLowerCase();

    // --- Ctrl + Key ---
    if (event.ctrlKey && !event.shiftKey && !event.altKey) {
      switch (key) {
        case 'ArrowLeft':
          return KeyboardAction.PreviousSubtitledClip;
        case 'ArrowRight':
          return KeyboardAction.NextSubtitledClip;
        case 'ArrowUp':
          return KeyboardAction.RepeatCurrentClip;
        case 'ArrowDown':
          return KeyboardAction.ForceContinue;
        case '[':
          return KeyboardAction.AdjustClipStartRight;
        case ']':
          return KeyboardAction.AdjustClipEndLeft;
        case 'z':
        case 'Z':
          return KeyboardAction.Undo;
        case 'y':
        case 'Y':
          return KeyboardAction.Redo;
        case 'e':
        case 'E':
          return KeyboardAction.ExportToAnki;
      }
    }

    // --- Ctrl + Shift + Key ---
    if (event.ctrlKey && event.shiftKey && !event.altKey) {
      if (lowerKey === 'z') return KeyboardAction.Redo;
    }

    // --- No Modifiers (or Shift for casing) ---
    if (!event.ctrlKey && !event.altKey) {
      switch (key) {
        case 'ArrowLeft':
          return KeyboardAction.SeekBackward;
        case 'ArrowRight':
          return KeyboardAction.SeekForward;
        case 'ArrowUp':
          return KeyboardAction.RepeatCurrentClip;
        case 'ArrowDown':
          return KeyboardAction.ForceContinue;
        case '[':
          return KeyboardAction.AdjustClipStartLeft;
        case ']':
          return KeyboardAction.AdjustClipEndRight;
        case 'Delete':
          return KeyboardAction.DeleteClip;
        case 'Insert':
          return KeyboardAction.CreateClip;
        case ' ':
          return KeyboardAction.TogglePlayPause;
        case '\\':
          return KeyboardAction.SplitClip;
        // Char keys (case-insensitive mapping)
        case ',':
          return KeyboardAction.ToggleSettings;
        default:
          if (lowerKey === 'c') return KeyboardAction.ToggleSubtitles;
          if (lowerKey === 's') return KeyboardAction.EditCurrentSubtitles;
          if (lowerKey === 'e') return KeyboardAction.ExportToAnki;
      }
    }

    return undefined;
  }
}
