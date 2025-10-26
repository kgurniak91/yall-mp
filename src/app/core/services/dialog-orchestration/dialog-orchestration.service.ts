import {inject, Injectable} from '@angular/core';
import {GlobalSettingsDialogComponent} from '../../../features/global-settings-dialog/global-settings-dialog.component';
import {DialogService} from 'primeng/dynamicdialog';
import {
  GlobalSettingsDialogConfig,
  GlobalSettingsTab
} from '../../../features/global-settings-dialog/global-settings-dialog.types';
import {HelpDialogComponent} from '../../../features/help-dialog/help-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class DialogOrchestrationService {
  private readonly dialogService = inject(DialogService);

  openGlobalSettingsDialog(tabIndex: GlobalSettingsTab = GlobalSettingsTab.General): void {
    window.electronAPI.playbackPause();

    const data: GlobalSettingsDialogConfig = {
      activeTabIndex: tabIndex
    };

    this.dialogService.open(GlobalSettingsDialogComponent, {
      header: 'Global settings',
      width: 'clamp(20rem, 95vw, 75rem)',
      focusOnShow: false,
      closable: true,
      modal: true,
      closeOnEscape: false,
      data
    });
  }

  openHelpDialog(): void {
    window.electronAPI.playbackPause();

    this.dialogService.open(HelpDialogComponent, {
      header: 'Help & About',
      width: 'clamp(20rem, 95vw, 55rem)',
      focusOnShow: false,
      closable: true,
      modal: true,
      closeOnEscape: false,
    });
  }
}
