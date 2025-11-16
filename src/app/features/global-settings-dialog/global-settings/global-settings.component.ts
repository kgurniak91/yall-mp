import {Component, inject} from '@angular/core';
import {Fieldset} from 'primeng/fieldset';
import {InputNumber} from 'primeng/inputnumber';
import {Slider} from 'primeng/slider';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {DEFAULT_GLOBAL_SETTINGS} from '../../../model/settings.types';
import {DecimalPipe} from '@angular/common';
import {InputSwitch} from 'primeng/inputswitch';

@Component({
  selector: 'app-global-settings',
  imports: [
    Fieldset,
    InputNumber,
    Slider,
    FormsModule,
    DecimalPipe,
    InputSwitch
  ],
  templateUrl: './global-settings.component.html',
  styleUrl: './global-settings.component.scss'
})
export class GlobalSettingsComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly MIN_SRT_FONT_SIZE = 1;
  protected readonly MAX_SRT_FONT_SIZE = 80;

  onSrtFontSizeChange(fontSize: number): void {
    let newFontSize: number;

    if (isNaN(fontSize)) {
      newFontSize = DEFAULT_GLOBAL_SETTINGS.srtFontSizePx;
    } else {
      if (fontSize < this.MIN_SRT_FONT_SIZE) {
        newFontSize = this.MIN_SRT_FONT_SIZE;
      } else if (fontSize > this.MAX_SRT_FONT_SIZE) {
        newFontSize = this.MAX_SRT_FONT_SIZE;
      } else {
        newFontSize = fontSize;
      }
    }

    this.globalSettingsStateService.setSrtFontSizePx(newFontSize);
  }

  onSrtBackgroundOpacityChange(opacity: number): void {
    let newOpacity: number;

    if (isNaN(opacity)) {
      newOpacity = DEFAULT_GLOBAL_SETTINGS.srtBackgroundOpacity;
    } else {
      if (opacity < 0) {
        newOpacity = 0;
      } else if (opacity > 1) {
        newOpacity = 1;
      } else {
        newOpacity = opacity;
      }
    }

    this.globalSettingsStateService.setSrtBackgroundOpacity(newOpacity);
  }
}
