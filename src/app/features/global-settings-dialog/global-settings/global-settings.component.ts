import {Component, inject} from '@angular/core';
import {Fieldset} from 'primeng/fieldset';
import {InputNumber} from 'primeng/inputnumber';
import {SelectButton} from 'primeng/selectbutton';
import {Slider} from 'primeng/slider';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle} from '../../../model/settings.types';

@Component({
  selector: 'app-global-settings',
  imports: [
    Fieldset,
    InputNumber,
    SelectButton,
    Slider,
    FormsModule
  ],
  templateUrl: './global-settings.component.html',
  styleUrl: './global-settings.component.scss'
})
export class GlobalSettingsComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  protected readonly hiddenSubtitleStyleOptions = [
    {label: 'Blur', value: HiddenSubtitleStyle.Blurred},
    {label: 'Hide', value: HiddenSubtitleStyle.Hidden}
  ];
}
