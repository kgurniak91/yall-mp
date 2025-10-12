import {inject, Injectable} from '@angular/core';
import {GlobalSettingsDialogComponent} from '../../../features/global-settings-dialog/global-settings-dialog.component';
import {DialogService} from 'primeng/dynamicdialog';
import {GlobalSettingsDialogConfig} from '../../../features/global-settings-dialog/global-settings-dialog.types';

@Injectable({
  providedIn: 'root'
})
export class DialogOrchestrationService {
  private readonly dialogService = inject(DialogService);

  openGlobalSettingsDialog(tabIndex: number = 0): void {
    const data: GlobalSettingsDialogConfig = {
      activeTabIndex: tabIndex
    };

    this.dialogService.open(GlobalSettingsDialogComponent, {
      header: 'Global settings',
      width: 'clamp(20rem, 95vw, 75rem)',
      focusOnShow: false,
      closable: true,
      modal: true,
      data
    });
  }
}
