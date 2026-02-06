import {createServiceFactory, mockProvider, SpectatorService} from '@ngneat/spectator';
import {GlobalKeyboardShortcutsService} from './global-keyboard-shortcuts.service';
import {DialogService} from 'primeng/dynamicdialog';
import {ConfirmationService} from 'primeng/api';
import {DialogOrchestrationService} from '../dialog-orchestration/dialog-orchestration.service';
import {KeyboardShortcutsHelperService} from '../keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {KeyboardAction} from '../../../model/video.types';
import {ActionType, KeyboardShortcutScope} from '../../../model/keyboard-shortcuts.types';

describe('GlobalKeyboardShortcutsService', () => {
  let spectator: SpectatorService<GlobalKeyboardShortcutsService>;

  const mockShortcutHelper = {
    getShortcutForEvent: (event: KeyboardEvent, scope: KeyboardShortcutScope) => {
      if (scope === KeyboardShortcutScope.Global && event.key === 'o') {
        return {
          action: KeyboardAction.OpenGlobalSettings,
          type: ActionType.SingleShot,
        };
      }

      if (scope === KeyboardShortcutScope.Global && event.key === 'F1') {
        return {
          action: KeyboardAction.OpenHelpDialog,
          type: ActionType.SingleShot,
        };
      }

      return undefined;
    },
  };

  const createService = createServiceFactory({
    service: GlobalKeyboardShortcutsService,
    providers: [
      mockProvider(DialogService),
      mockProvider(ConfirmationService),
      mockProvider(DialogOrchestrationService),
      {provide: KeyboardShortcutsHelperService, useValue: mockShortcutHelper},
    ],
  });

  beforeEach(() => {
    spectator = createService();
  });

  afterEach(() => {
    // Clean up event listeners attached to document
    spectator.service.ngOnDestroy();
  });

  function createKeyboardEvent(key: string, targetTag: string = 'TEXTAREA'): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: key,
      bubbles: true,
      cancelable: true,
    });
    const target = document.createElement(targetTag);
    Object.defineProperty(event, 'target', {value: target, enumerable: true});
    spyOn(event, 'preventDefault');
    spyOn(event, 'stopPropagation');
    return event;
  }

  describe('Character Blocking in Dialogs', () => {
    it('should NOT block normal characters (like "a") when typing in a dialog', () => {
      // Simulate a dialog being open
      spyOn(spectator.service as any, 'isAnyDialogOpen').and.returnValue(true);

      const event = createKeyboardEvent('a');
      document.dispatchEvent(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it('should NOT block shortcut-mapped characters (like "o") when typing in a dialog', () => {
      // Simulate a dialog being open
      spyOn(spectator.service as any, 'isAnyDialogOpen').and.returnValue(true);

      // 'o' is a global shortcut key
      const event = createKeyboardEvent('o');
      document.dispatchEvent(event);

      expect(event.preventDefault).withContext('Should not prevent typing "o"').not.toHaveBeenCalled();
      expect(event.stopPropagation).withContext('Should not stop propagation of "o"').not.toHaveBeenCalled();
    });

    it('should still block actual functional shortcuts (like "F1") when a dialog is already open', () => {
      spyOn(spectator.service as any, 'isAnyDialogOpen').and.returnValue(true);

      // F1 is a shortcut and is NOT a typing key
      const event = createKeyboardEvent('F1', 'DIV'); // Target is not an input
      document.dispatchEvent(event);

      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });
});
