import {inject, Injectable, OnDestroy} from '@angular/core';
import {DialogService} from 'primeng/dynamicdialog';
import {ConfirmationService} from 'primeng/api';

@Injectable({
  providedIn: 'root'
})
export class GlobalKeyboardShortcutsService implements OnDestroy {
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);

  constructor() {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Ignore keyboard events from input fields to prevent them from triggering shortcuts
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();

      const isProjectSettingsDrawerOpened = document.querySelector('.p-drawer-active app-current-project-settings');
      if (isProjectSettingsDrawerOpened) {
        // Handled in ProjectKeyboardShortcutsService
        return;
      }

      // Close the confirmation dialog if any
      const visibleConfirmationDialog = document.querySelector('.p-dialog-mask .p-confirmdialog');
      if (visibleConfirmationDialog) {
        this.confirmationService.close();
        return;
      }

      // If no confirmation dialog, check for and close the topmost regular dialog
      if (this.dialogService.dialogComponentRefMap.size > 0) {
        const dialogRefs = Array.from(this.dialogService.dialogComponentRefMap.keys());
        const topDialogRef = dialogRefs[dialogRefs.length - 1];
        topDialogRef.close();
        return;
      }

      // If no dialogs nor drawers are open, perform the window action (exit fullscreen or minimize)
      window.electronAPI.windowEscape();
    }
  };
}
