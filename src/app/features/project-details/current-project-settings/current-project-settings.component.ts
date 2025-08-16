import {Component, computed, input, output} from '@angular/core';
import {MediaTrack} from '../../../../../shared/types/media.type';
import {ProjectSettings, SettingsPreset} from '../../../model/settings.types';
import {Fieldset} from 'primeng/fieldset';
import {Select} from 'primeng/select';
import {
  CommonProjectSettingsComponent
} from '../../../shared/components/common-project-settings/common-project-settings.component';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-current-project-settings',
  imports: [
    Fieldset,
    Select,
    CommonProjectSettingsComponent,
    FormsModule
  ],
  templateUrl: './current-project-settings.component.html',
  styleUrl: './current-project-settings.component.scss'
})
export class CurrentProjectSettingsComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly audioTracks = input<MediaTrack[]>([]);
  public readonly settingsPresets = input.required<SettingsPreset[]>();
  public readonly selectedSettingsPreset = input.required<SettingsPreset | null>();
  public readonly settingsChange = output<ProjectSettings>();
  public readonly selectedSettingsPresetChange = output<SettingsPreset | null>();
  protected readonly audioTrackOptions = computed(() => {
    return this.audioTracks().map(track => ({
      label: track.label || `Track ${track.index}`,
      value: track.index
    }));
  });

  protected onSettingsPresetChange(preset: SettingsPreset | null): void {
    this.selectedSettingsPresetChange.emit(preset);
  }

  protected onAudioTrackChange(trackIndex: number): void {
    window.electronAPI.mpvSetProperty('aid', trackIndex);
    this.onSettingChange('selectedAudioTrackIndex', trackIndex);
  }

  protected onSettingChange<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]): void {
    this.settingsChange.emit({
      ...this.settings(),
      [key]: value
    });
  }
}
