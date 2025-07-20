import {Component, inject} from '@angular/core';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle, ProjectSettings} from '../../model/settings.types';
import {Tab, TabList, TabPanel, TabPanels, Tabs} from 'primeng/tabs';
import {ProjectSettingsComponent} from '../../shared/components/project-settings/project-settings.component';
import {Fieldset} from 'primeng/fieldset';
import {Slider} from 'primeng/slider';
import {SelectButton} from 'primeng/selectbutton';
import {InputNumber} from 'primeng/inputnumber';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-global-settings-dialog',
  imports: [
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProjectSettingsComponent,
    Fieldset,
    Slider,
    SelectButton,
    InputNumber,
    FormsModule
  ],
  templateUrl: './global-settings-dialog.component.html',
  styleUrl: './global-settings-dialog.component.scss'
})
export class GlobalSettingsDialogComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  protected readonly hiddenSubtitleStyleOptions = [
    {label: 'Blur', value: HiddenSubtitleStyle.Blurred},
    {label: 'Hide', value: HiddenSubtitleStyle.Hidden}
  ];

  onDefaultSettingsChange(newDefaults: ProjectSettings) {
    this.globalSettingsStateService.setDefaultProjectSettings(newDefaults);
  }
}
