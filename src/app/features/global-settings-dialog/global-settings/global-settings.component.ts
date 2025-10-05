import {Component, inject} from '@angular/core';
import {Fieldset} from 'primeng/fieldset';
import {InputNumber} from 'primeng/inputnumber';
import {Slider} from 'primeng/slider';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';

@Component({
  selector: 'app-global-settings',
  imports: [
    Fieldset,
    InputNumber,
    Slider,
    FormsModule
  ],
  templateUrl: './global-settings.component.html',
  styleUrl: './global-settings.component.scss'
})
export class GlobalSettingsComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
}
