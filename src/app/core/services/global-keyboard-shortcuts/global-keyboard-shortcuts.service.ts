import {inject, Injectable, OnDestroy} from '@angular/core';
import {DialogService} from 'primeng/dynamicdialog';
import {ConfirmationService} from 'primeng/api';
import {DialogOrchestrationService} from '../dialog-orchestration/dialog-orchestration.service';
import {KeyboardAction} from '../../../model/video.types';
import {KeyboardShortcutsHelperService} from '../keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {ActionType, KeyboardShortcutScope} from '../../../model/keyboard-shortcuts.types';

@Injectable({
  providedIn: 'root'
})
export class GlobalKeyboardShortcutsService implements OnDestroy {
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly keyboardShortcutsHelperService = inject(KeyboardShortcutsHelperService);
  private activeKeys = new Set<string>();

  constructor() {
    // Using `capture: true` ensures this listener runs before any other services (like the project-specific one)
    document.addEventListener('keydown', this.handleKeyDown, {capture: true});
    document.addEventListener('keyup', this.handleKeyUp, {capture: true});
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown, {capture: true});
    document.removeEventListener('keyup', this.handleKeyUp, {capture: true});
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.activeKeys.delete(event.code);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const isTyping = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    // Handle events when a dialog is open
    if (this.isAnyDialogOpen()) {
      // Stop the event from propagating to other listeners (like the project-specific shortcuts)
      event.stopPropagation();

      if (event.key === 'Enter' && !isTyping) {
        event.preventDefault();
        this.handleEnterKey();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.handleEscapeKey();
      }

      // For any other key do nothing, but the event propagation remains stopped to prevent shortcuts from working inside dialogs
      return;
    }

    // If no dialog is open, check for other global shortcuts
    const globalShortcut = this.keyboardShortcutsHelperService.getShortcutForEvent(event, KeyboardShortcutScope.Global);
    if (!globalShortcut) {
      // Shortcuts that are not global are allowed to propagate to listeners like ProjectKeyboardShortcutsService
      return;
    }

    // When typing, ignore all global shortcuts except for ESC for closing the dialog
    if (isTyping && (globalShortcut.action !== KeyboardAction.CloseDialogOrEsc)) {
      return;
    }

    // Consume events other than 'Escape', this allows the project service to handle closing the settings drawer
    if (globalShortcut.action !== KeyboardAction.CloseDialogOrEsc) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (globalShortcut.type === ActionType.SingleShot) {
      if (this.activeKeys.has(event.code)) {
        return;
      }
      this.activeKeys.add(event.code);
    }

    this.executeGlobalAction(globalShortcut.action, event);
  };

  private executeGlobalAction(action: KeyboardAction, event: KeyboardEvent): void {
    switch (action) {
      case KeyboardAction.OpenHelpDialog:
        this.dialogOrchestrationService.openHelpDialog();
        break;
      case KeyboardAction.OpenGlobalSettings:
        this.dialogOrchestrationService.openGlobalSettingsDialog();
        break;
      case KeyboardAction.ToggleFullScreen:
        window.electronAPI.windowToggleFullScreen();
        break;
      case KeyboardAction.CloseDialogOrEsc:
        this.handleEscapeKey();

        // If the drawer was NOT open, the escape key's default window action should be prevented.
        if (!this.isDrawerOpen()) {
          event.preventDefault();
        }

        break;
    }
  }

  private handleEscapeKey(): void {
    // If the drawer is open, do nothing and let the event propagate to the ProjectKeyboardShortcutsService
    if (this.isDrawerOpen()) {
      return;
    }

    // Close the confirmation dialog if any
    if (this.isConfirmDialogOpen()) {
      this.confirmationService.close();
      return;
    }

    // If no confirmation dialog, check for and close the topmost regular dialog
    if (this.isDynamicDialogOpen()) {
      const dialogRefs = Array.from(this.dialogService.dialogComponentRefMap.keys());
      const topDialogRef = dialogRefs[dialogRefs.length - 1];
      topDialogRef.close();
      return;
    }

    // If no dialogs or drawers are open, perform the window action (exit fullscreen mode or minimize)
    window.electronAPI.windowEscape();
  }

  private handleEnterKey(): void {
    const topDialogMask = this.getTopDialogMask();
    if (!topDialogMask) {
      return;
    }

    if (this.isConfirmDialogOpen()) {
      const confirmDialog = topDialogMask.querySelector('.p-confirmdialog');
      const acceptButton = confirmDialog?.querySelector('.p-confirmdialog-accept-button') as HTMLElement;
      acceptButton?.click();
      return;
    }

    if (this.isDynamicDialogOpen()) {
      const dynamicDialog = topDialogMask.querySelector('.p-dialog');
      const primaryButton = dynamicDialog?.querySelector('[data-primary-action]') as HTMLElement;
      primaryButton?.click();
    }
  }

  private getTopDialogMask(): HTMLElement | undefined {
    const dialogs = Array.from(document.querySelectorAll('.p-dialog-mask.p-overlay-mask'));
    return dialogs[dialogs.length - 1] as HTMLElement | undefined;
  }

  private isDynamicDialogOpen(): boolean {
    return this.dialogService.dialogComponentRefMap.size > 0;
  }

  private isConfirmDialogOpen(): boolean {
    return Boolean(this.getTopDialogMask()?.querySelector('.p-confirmdialog'));
  }

  private isAnyDialogOpen(): boolean {
    return this.isDynamicDialogOpen() || this.isConfirmDialogOpen();
  }

  private isDrawerOpen(): boolean {
    return Boolean(document.querySelector('.p-drawer-active app-current-project-settings'));
  }
}
