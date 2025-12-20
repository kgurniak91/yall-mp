import {inject, Injectable, signal} from '@angular/core';
import {GlobalSettingsDialogComponent} from '../../../features/global-settings-dialog/global-settings-dialog.component';
import {DialogService} from 'primeng/dynamicdialog';
import {
  GlobalSettingsDialogConfig,
  GlobalSettingsTab
} from '../../../features/global-settings-dialog/global-settings-dialog.types';
import {HelpDialogComponent} from '../../../features/help-dialog/help-dialog.component';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {take} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DialogOrchestrationService {
  private readonly _dialogOpenedTrigger = signal(0);
  private readonly dialogService = inject(DialogService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  public readonly dialogOpenedTrigger = this._dialogOpenedTrigger.asReadonly();

  openGlobalSettingsDialog(tabIndex: GlobalSettingsTab = GlobalSettingsTab.General): void {
    this._dialogOpenedTrigger.update(v => v + 1);
    window.electronAPI.playbackPause();

    const data: GlobalSettingsDialogConfig = {
      activeTabIndex: tabIndex
    };

    const ref = this.dialogService.open(GlobalSettingsDialogComponent, {
      header: 'Global settings',
      width: 'clamp(20rem, 95vw, 100rem)',
      height: 'clamp(20rem, 95vw, 100rem)',
      focusOnShow: false,
      closable: true,
      modal: true,
      closeOnEscape: false,
      data
    });

    ref.onClose.pipe(
      take(1)
    ).subscribe(() => {
      this.globalSettingsStateService.notifySettingsChanged();
    });
  }

  openHelpDialog(): void {
    this._dialogOpenedTrigger.update(v => v + 1);
    window.electronAPI.playbackPause();

    this.dialogService.open(HelpDialogComponent, {
      header: 'Help & About',
      width: 'clamp(20rem, 95vw, 60rem)',
      focusOnShow: false,
      closable: true,
      modal: true,
      closeOnEscape: false,
    });
  }
}
