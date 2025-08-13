import {Component, computed, input, output} from '@angular/core';
import {ProjectSettings, SubtitleBehavior} from '../../../model/settings.types';
import {Fieldset} from 'primeng/fieldset';
import {SelectButton} from 'primeng/selectbutton';
import {Slider} from 'primeng/slider';
import {InputSwitch} from 'primeng/inputswitch';
import {FormsModule} from '@angular/forms';
import {Select} from 'primeng/select';
import {MediaTrack} from '../../../../../shared/types/media.type';

@Component({
  selector: 'app-project-settings',
  imports: [
    Fieldset,
    SelectButton,
    Slider,
    InputSwitch,
    FormsModule,
    Select
  ],
  templateUrl: './project-settings.component.html',
  styleUrl: './project-settings.component.scss'
})
export class ProjectSettingsComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly audioTracks = input<MediaTrack[]>([]);
  public readonly settingsChange = output<ProjectSettings>();

  protected readonly subtitleBehaviorOptions = [
    {label: 'Do Nothing', value: SubtitleBehavior.DoNothing},
    {label: 'Force Show', value: SubtitleBehavior.ForceShow},
    {label: 'Force Hide', value: SubtitleBehavior.ForceHide}
  ];

  protected readonly audioTrackOptions = computed(() => {
    return this.audioTracks().map(track => ({
      label: track.label || `Track ${track.index}`,
      value: track.index
    }));
  });

  protected onSettingChange<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]): void {
    this.settingsChange.emit({
      ...this.settings(),
      [key]: value
    });
  }

  protected onAudioTrackChange(trackIndex: number): void {
    window.electronAPI.mpvSetProperty('aid', trackIndex);
    this.onSettingChange('selectedAudioTrackIndex', trackIndex);
  }
}
