import {Component, inject, OnInit, signal} from '@angular/core';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {FormsModule} from '@angular/forms';
import {Message} from 'primeng/message';
import {Fieldset} from 'primeng/fieldset';
import {Button} from 'primeng/button';
import {CustomPath, CustomPathKey} from '../../../model/settings.types';
import {InputText} from 'primeng/inputtext';
import {Tooltip} from 'primeng/tooltip';
import type {ExecutableInUse} from '../../../../electron-api';
import {ToastService} from '../../../shared/services/toast/toast.service';

@Component({
  selector: 'app-advanced-settings',
  imports: [
    FormsModule,
    Message,
    Fieldset,
    Button,
    InputText,
    Tooltip
  ],
  templateUrl: './advanced-settings.component.html',
  styleUrl: './advanced-settings.component.scss'
})
export class AdvancedSettingsComponent implements OnInit {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly customExecutables = Object.entries(CustomPath).map(([key, label]) => ({
    key: key as CustomPathKey,
    label: label as string
  }));
  protected readonly pathErrors = signal<Record<string, boolean>>({});
  /** What the app actually runs for each executable (resolved by the main process). */
  protected readonly executablesInUse = signal<Record<string, ExecutableInUse> | null>(null);
  private readonly toastService = inject(ToastService);

  ngOnInit() {
    this.refreshExecutablesInUse();
    this.customExecutables.forEach(async (exe) => {
      const currentPath = this.globalSettingsStateService[exe.key]();
      if (currentPath) {
        const exists = await window.electronAPI.checkFileExists(currentPath);
        this.pathErrors.update(errs => ({...errs, [exe.key]: !exists}));
      }
    });
  }

  async browseCustomExe(key: CustomPathKey): Promise<void> {
    const filePaths = await window.electronAPI.openFileDialog({
      title: `Select ${CustomPath[key]} Executable`,
      properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
      this.onPathChange(key, filePaths[0]);
    }
  }

  private async refreshExecutablesInUse(): Promise<void> {
    try {
      this.executablesInUse.set(await window.electronAPI.getExecutablesInUse());
    } catch {
      this.executablesInUse.set(null);
    }
  }

  protected async copyBrewCommand(): Promise<void> {
    await navigator.clipboard.writeText('brew install ffmpeg');
    this.toastService.info('Copied "brew install ffmpeg". Paste it into Terminal.');
  }

  async onPathChange(key: CustomPathKey, path: string) {
    this.globalSettingsStateService.setCustomPath(key, path);

    if (!path) {
      this.pathErrors.update(errs => ({...errs, [key]: false}));
      return;
    }

    const exists = await window.electronAPI.checkFileExists(path);
    this.pathErrors.update(errs => ({...errs, [key]: !exists}));
  }
}
