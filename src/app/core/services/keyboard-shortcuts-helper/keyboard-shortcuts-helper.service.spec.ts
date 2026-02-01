import {createServiceFactory, SpectatorService} from '@ngneat/spectator';
import {KeyboardShortcutsHelperService} from './keyboard-shortcuts-helper.service';
import {MockBuilder} from 'ng-mocks';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {signal} from '@angular/core';
import {KeyboardAction} from '../../../model/video.types';
import {KeyboardShortcutScope} from '../../../model/keyboard-shortcuts.types';

describe('KeyboardShortcutsHelperService', () => {
  const swapNavigationSignal = signal(false);

  const dependencies = MockBuilder(KeyboardShortcutsHelperService)
    .mock(GlobalSettingsStateService, {
      swapNavigationShortcuts: swapNavigationSignal.asReadonly()
    })
    .build();

  const createService = createServiceFactory({
    service: KeyboardShortcutsHelperService,
    ...dependencies
  });

  let spectator: SpectatorService<KeyboardShortcutsHelperService>;
  let service: KeyboardShortcutsHelperService;

  beforeEach(() => {
    swapNavigationSignal.set(false);
    spectator = createService();
    service = spectator.service;
    // Flush effects to trigger map building in constructor
    spectator.flushEffects();
  });

  describe('generateEventKey', () => {
    const generateKey = (e: KeyboardEvent, ignoreShift?: boolean) => (service as any).generateEventKey(e, ignoreShift);

    it('handles standard keys', () => {
      const event = new KeyboardEvent('keydown', {key: 'a'});
      expect(generateKey(event)).toBe('a');
    });

    it('handles modifier keys + standard keys', () => {
      const event = new KeyboardEvent('keydown', {key: 's', ctrlKey: true, shiftKey: true});
      expect(generateKey(event)).toBe('ctrl-shift-s');
    });

    it('handles Shift key alone without duplicating it', () => {
      const event = new KeyboardEvent('keydown', {key: 'Shift', shiftKey: true});
      expect(generateKey(event)).toBe('shift');
    });

    it('handles Control key alone', () => {
      const event = new KeyboardEvent('keydown', {key: 'Control', ctrlKey: true});
      expect(generateKey(event)).toBe('control');
    });

    it('handles Alt key alone', () => {
      const event = new KeyboardEvent('keydown', {key: 'Alt', altKey: true});
      expect(generateKey(event)).toBe('alt');
    });

    it('handles navigation keys', () => {
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight'});
      expect(generateKey(event)).toBe('arrowright');
    });
  });

  describe('Shortcut Lookup', () => {
    it('returns undefined for unbound keys', () => {
      const event = new KeyboardEvent('keydown', {key: 'x'}); // 'x' is not bound
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);
      expect(shortcut).toBeUndefined();
    });

    it('finds global shortcuts', () => {
      const event = new KeyboardEvent('keydown', {key: 'F1'});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Global);

      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(KeyboardAction.OpenHelpDialog);
    });

    it('finds project shortcuts', () => {
      const event = new KeyboardEvent('keydown', {key: ' '});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(KeyboardAction.TogglePlayPause);
    });

    it('finds the Speed Override shortcut', () => {
      const event = new KeyboardEvent('keydown', {key: 'Shift', shiftKey: true});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(KeyboardAction.ActivateSpeedOverride);
    });
  });

  describe('Shortcut Lookup with Speed Override (Shift)', () => {
    it('resolves explicit Shift shortcuts (e.g. Redo)', () => {
      // Ctrl+Shift+Z -> Redo
      const event = new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey: true});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(KeyboardAction.Redo);
    });

    it('resolves standard shortcuts while holding Shift (Fallthrough)', () => {
      // Shift + ArrowRight -> Should act as ArrowRight (SeekForward)
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight', shiftKey: true});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe(KeyboardAction.SeekForward);
    });
  });

  describe('Swap Navigation Shortcuts', () => {
    it('uses standard arrow keys for seeking by default', () => {
      swapNavigationSignal.set(false);
      spectator.flushEffects();

      // Right Arrow -> Seek Forward
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight'});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut?.action).toBe(KeyboardAction.SeekForward);
    });

    it('uses Ctrl+Arrow for clip navigation by default', () => {
      swapNavigationSignal.set(false);
      spectator.flushEffects();

      // Ctrl + Right Arrow -> Next Subtitled Clip
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight', ctrlKey: true});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut?.action).toBe(KeyboardAction.NextSubtitledClip);
    });

    it('swaps arrows to clip navigation when setting is enabled', () => {
      swapNavigationSignal.set(true);
      spectator.flushEffects();

      // Right Arrow -> Next Subtitled Clip
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight'});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut?.action).toBe(KeyboardAction.NextSubtitledClip);
    });

    it('swaps Ctrl+Arrows to seeking when setting is enabled', () => {
      swapNavigationSignal.set(true);
      spectator.flushEffects();

      // Ctrl + Right Arrow -> Seek Forward
      const event = new KeyboardEvent('keydown', {key: 'ArrowRight', ctrlKey: true});
      const shortcut = service.getShortcutForEvent(event, KeyboardShortcutScope.Project);

      expect(shortcut?.action).toBe(KeyboardAction.SeekForward);
    });
  });
});
