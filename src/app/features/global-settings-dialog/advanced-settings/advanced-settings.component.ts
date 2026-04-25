import {Component, inject, OnInit, signal} from '@angular/core';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {FormsModule} from '@angular/forms';
import {Message} from 'primeng/message';
import {Fieldset} from 'primeng/fieldset';
import {Button} from 'primeng/button';
import {CustomPath, CustomPathKey} from '../../../model/settings.types';
import {InputText} from 'primeng/inputtext';

@Component({
  selector: 'app-advanced-settings',
  imports: [
    FormsModule,
    Message,
    Fieldset,
    Button,
    InputText
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

  ngOnInit() {
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
