import {Component, input, output} from '@angular/core';
import {HiddenSubtitleStyle, ProjectSettings, SubtitleBehavior} from '../../../model/settings.types';
import {Fieldset} from 'primeng/fieldset';
import {SelectButton} from 'primeng/selectbutton';
import {Slider} from 'primeng/slider';
import {InputSwitch} from 'primeng/inputswitch';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-project-settings',
  imports: [
    Fieldset,
    SelectButton,
    Slider,
    InputSwitch,
    FormsModule
  ],
  templateUrl: './project-settings.component.html',
  styleUrl: './project-settings.component.scss'
})
export class ProjectSettingsComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly settingsChange = output<ProjectSettings>();

  protected readonly subtitleBehaviorOptions = [
    {label: 'Do Nothing', value: SubtitleBehavior.DoNothing},
    {label: 'Force Show', value: SubtitleBehavior.ForceShow},
    {label: 'Force Hide', value: SubtitleBehavior.ForceHide}
  ];

  protected onSettingChange<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]): void {
    this.settingsChange.emit({
      ...this.settings(),
      [key]: value
    });
  }
}
