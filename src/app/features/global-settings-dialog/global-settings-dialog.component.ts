import {Component, inject} from '@angular/core';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {ProjectSettings} from '../../model/settings.types';
import {Tab, TabList, TabPanel, TabPanels, Tabs} from 'primeng/tabs';
import {ProjectSettingsComponent} from '../../shared/components/project-settings/project-settings.component';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsComponent} from './global-settings/global-settings.component';
import {AnkiSettingsComponent} from './anki-settings/anki-settings.component';

@Component({
  selector: 'app-global-settings-dialog',
  imports: [
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProjectSettingsComponent,
    FormsModule,
    GlobalSettingsComponent,
    AnkiSettingsComponent
  ],
  templateUrl: './global-settings-dialog.component.html',
  styleUrl: './global-settings-dialog.component.scss'
})
export class GlobalSettingsDialogComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  onDefaultSettingsChange(newDefaults: ProjectSettings) {
    this.globalSettingsStateService.setDefaultProjectSettings(newDefaults);
  }
}
