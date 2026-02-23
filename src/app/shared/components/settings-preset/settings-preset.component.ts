import {Component, computed, input, output} from '@angular/core';
import {
  BuiltInSettingsPreset,
  BuiltInSettingsPresets,
  ProjectSettings,
  SettingsPreset
} from '../../../model/settings.types';
import {Select} from 'primeng/select';
import {Fieldset} from 'primeng/fieldset';
import {FormsModule} from '@angular/forms';
import {Message} from 'primeng/message';

@Component({
  selector: 'app-settings-preset',
  imports: [
    Select,
    Fieldset,
    FormsModule,
    Message
  ],
  templateUrl: './settings-preset.component.html',
  styleUrl: './settings-preset.component.scss'
})
export class SettingsPresetComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly settingsChange = output<ProjectSettings>();

  protected readonly BuiltInSettingsPresets = BuiltInSettingsPresets;
  protected readonly BuiltInSettingsPreset = BuiltInSettingsPreset;

  private readonly settingsPresetKeys: (keyof ProjectSettings)[] = [
    'autoPauseAtStart',
    'autoPauseAtEnd',
    'subtitleBehavior'
  ];

  protected readonly activePreset = computed(() => {
    const currentSettings = this.settings();
    return BuiltInSettingsPresets.find(preset =>
      this.settingsPresetKeys.every(k => currentSettings[k] === preset.settings[k])
    ) || null;
  });

  protected onSettingsPresetChange(preset: SettingsPreset | null): void {
    if (preset) {
      this.settingsChange.emit({
        ...this.settings(),
        ...preset.settings
      });
    }
  }
}
