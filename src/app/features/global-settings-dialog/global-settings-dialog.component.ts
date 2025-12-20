import {Component, effect, inject, signal} from '@angular/core';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {ProjectSettings} from '../../model/settings.types';
import {Tab, TabList, TabPanel, TabPanels, Tabs} from 'primeng/tabs';
import {
  CommonProjectSettingsComponent
} from '../../shared/components/common-project-settings/common-project-settings.component';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsComponent} from './global-settings/global-settings.component';
import {AnkiSettingsComponent} from './anki-settings/anki-settings.component';
import {SubtitlesLookupSettingsComponent} from './subtitles-lookup-settings/subtitles-lookup-settings.component';
import {DynamicDialogConfig} from 'primeng/dynamicdialog';
import {GlobalSettingsDialogConfig, GlobalSettingsTab} from './global-settings-dialog.types';
import {AnkiStateService} from '../../state/anki/anki-state.service';
import {
  OfflineDictionariesSettingsComponent
} from './offline-dictionaries-settings/offline-dictionaries-settings.component';

@Component({
  selector: 'app-global-settings-dialog',
  imports: [
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    CommonProjectSettingsComponent,
    FormsModule,
    GlobalSettingsComponent,
    AnkiSettingsComponent,
    SubtitlesLookupSettingsComponent,
    OfflineDictionariesSettingsComponent
  ],
  templateUrl: './global-settings-dialog.component.html',
  styleUrl: './global-settings-dialog.component.scss'
})
export class GlobalSettingsDialogComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly selectedTabIndex = signal(GlobalSettingsTab.General);
  protected readonly GlobalSettingsTab = GlobalSettingsTab;
  private readonly config = inject(DynamicDialogConfig);
  private readonly ankiStateService = inject(AnkiStateService);
  private readonly data: GlobalSettingsDialogConfig;

  constructor() {
    this.data = this.config.data as GlobalSettingsDialogConfig;
    this.selectedTabIndex.set(this.data.activeTabIndex || GlobalSettingsTab.General);

    effect(() => {
      if (this.selectedTabIndex() === GlobalSettingsTab.Anki) {
        this.ankiStateService.checkAnkiConnection();
      }
    });
  }

  onDefaultSettingsChange(newDefaults: ProjectSettings) {
    this.globalSettingsStateService.setDefaultProjectSettings(newDefaults);
  }

  onExternalLinkClick(url: string, event: MouseEvent): void {
    event.preventDefault();
    window.electronAPI.openInSystemBrowser(url);
  }
}
