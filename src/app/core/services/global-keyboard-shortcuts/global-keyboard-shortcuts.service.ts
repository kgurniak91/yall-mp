import {inject, Injectable, OnDestroy} from '@angular/core';
import {DialogService} from 'primeng/dynamicdialog';
import {ConfirmationService} from 'primeng/api';
import {DialogOrchestrationService} from '../dialog-orchestration/dialog-orchestration.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalKeyboardShortcutsService implements OnDestroy {
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);

  constructor() {
    document.addEventListener('keydown', this.handleKeyDown, {capture: true});
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown, {capture: true});
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (event.key !== 'Escape' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    if (this.isAnyDialogOpen()) {
      // Stop the event from propagating to other listeners (like the project-specific shortcuts).
      event.stopPropagation();

      switch (event.key) {
        case 'Escape':
          this.handleEscapeKey(event);
          break;
        case 'Enter':
          this.handleEnterKey(event);
          break;
      }
      return;
    }

    // Handle global shortcuts that are only active when no dialogs are open
    // Other events are allowed to propagate to listeners like ProjectKeyboardShortcutsService
    if (event.key === 'Escape') {
      this.handleEscapeKey(event);
    } else if (event.key.toLowerCase() === 'o' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.dialogOrchestrationService.openGlobalSettingsDialog();
    }
  };

  private handleEscapeKey(event: KeyboardEvent): void {
    if (this.isDrawerOpen()) {
      // Handled in ProjectKeyboardShortcutsService
      return;
    }

    event.stopPropagation();
    event.preventDefault();

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

    // If no dialogs or drawers are open, perform the window action
    window.electronAPI.windowEscape();
  }

  private handleEnterKey(event: KeyboardEvent): void {
    const topDialogMask = this.getTopDialogMask();
    if (!topDialogMask) {
      return;
    }

    event.preventDefault();

    if (this.isConfirmDialogOpen()) {
      const confirmDialog = topDialogMask.querySelector('.p-confirmdialog');
      const acceptButton = confirmDialog?.querySelector('.p-confirmdialog-accept-button') as HTMLElement;
      if (acceptButton) {
        acceptButton.click();
      }
      return;
    }

    if (this.isDynamicDialogOpen()) {
      const dynamicDialog = topDialogMask.querySelector('.p-dialog');
      const primaryButton = dynamicDialog?.querySelector('[data-primary-action]') as HTMLElement;
      if (primaryButton) {
        primaryButton.click();
      }
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
