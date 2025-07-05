import {Component, inject} from '@angular/core';
import {SettingsStateService} from '../../../state/settings/settings-state.service';
import {HiddenSubtitleStyle, SubtitleBehavior} from '../../../model/settings.types';
import {Fieldset} from 'primeng/fieldset';
import {SelectButton} from 'primeng/selectbutton';
import {Slider} from 'primeng/slider';
import {InputSwitch} from 'primeng/inputswitch';
import {FormsModule} from '@angular/forms';
import {InputNumber} from 'primeng/inputnumber';

@Component({
  selector: 'app-project-settings',
  imports: [
    Fieldset,
    SelectButton,
    Slider,
    InputSwitch,
    FormsModule,
    InputNumber
  ],
  templateUrl: './project-settings.component.html',
  styleUrl: './project-settings.component.scss'
})
export class ProjectSettingsComponent {
  protected readonly settingsService = inject(SettingsStateService);

  protected subtitleBehaviorOptions = [
    {label: 'Do Nothing', value: SubtitleBehavior.DoNothing},
    {label: 'Force Show', value: SubtitleBehavior.ForceShow},
    {label: 'Force Hide', value: SubtitleBehavior.ForceHide}
  ];

  protected hiddenSubtitleStyleOptions = [
    {label: 'Blur', value: HiddenSubtitleStyle.Blurred},
    {label: 'Hide', value: HiddenSubtitleStyle.Hidden}
  ];
}
