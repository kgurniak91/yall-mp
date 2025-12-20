export interface GlobalSettingsDialogConfig {
  activeTabIndex: number;
}

export enum GlobalSettingsTab {
  General = 0,
  ProjectDefaults = 1,
  Anki = 2,
  OnlineLookups = 3,
  OfflineDictionaries = 4,
}
