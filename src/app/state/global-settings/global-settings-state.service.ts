import {computed, inject, Injectable, signal} from '@angular/core';
import {AppStateService} from '../app/app-state.service';
import {ProjectSettings, SubtitleLookupBrowserType, SubtitleLookupService} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class GlobalSettingsStateService {
  private readonly appStateService = inject(AppStateService);
  private readonly _settingsReloadTrigger = signal(0);

  public readonly boundaryAdjustAmountMs = computed(() => this.appStateService.globalSettings().boundaryAdjustAmountMs);
  public readonly seekAmountSeconds = computed(() => this.appStateService.globalSettings().seekAmountSeconds);
  public readonly defaultProjectSettings = computed(() => this.appStateService.globalSettings().defaultProjectSettings);
  public readonly subtitleLookupServices = computed(() => this.appStateService.globalSettings().subtitleLookupServices);
  public readonly subtitleLookupBrowserType = computed(() => this.appStateService.globalSettings().subtitleLookupBrowserType);
  public readonly ankiSuspendNewCardsByDefault = computed(() => this.appStateService.globalSettings().ankiSuspendNewCardsByDefault);
  public readonly srtFontSizePx = computed(() => this.appStateService.globalSettings().srtFontSizePx);
  public readonly srtBackgroundOpacity = computed(() => this.appStateService.globalSettings().srtBackgroundOpacity);
  public readonly generateAudioPeaks = computed(() => this.appStateService.globalSettings().generateAudioPeaks);
  public readonly srtBackgroundColor = computed(() => `rgba(0, 0, 0, ${this.srtBackgroundOpacity()})`);
  public readonly settingsReloadTrigger = this._settingsReloadTrigger.asReadonly();

  public notifySettingsChanged(): void {
    this._settingsReloadTrigger.update(v => v + 1);
  }

  public setBoundaryAdjustAmountMs(value: number): void {
    this.appStateService.updateGlobalSettings({boundaryAdjustAmountMs: value});
  }

  public setSeekAmountSeconds(value: number): void {
    this.appStateService.updateGlobalSettings({seekAmountSeconds: value});
  }

  public setDefaultProjectSettings(newDefaults: ProjectSettings): void {
    const currentGlobalSettings = this.appStateService.globalSettings();
    this.appStateService.updateGlobalSettings({
      ...currentGlobalSettings,
      defaultProjectSettings: newDefaults
    });
  }

  public setSrtFontSizePx(value: number): void {
    this.appStateService.updateGlobalSettings({srtFontSizePx: value});
  }

  public setSrtBackgroundOpacity(value: number): void {
    this.appStateService.updateGlobalSettings({srtBackgroundOpacity: value});
  }

  public setSubtitleLookupBrowserType(value: SubtitleLookupBrowserType): void {
    this.appStateService.updateGlobalSettings({subtitleLookupBrowserType: value});
  }

  public updateSubtitleLookupServices(services: SubtitleLookupService[]): void {
    this.appStateService.updateGlobalSettings({subtitleLookupServices: services});
  }

  public setAnkiSuspendNewCardsByDefault(value: boolean): void {
    this.appStateService.updateGlobalSettings({ankiSuspendNewCardsByDefault: value});
  }

  public setGenerateAudioPeaks(value: boolean): void {
    this.appStateService.updateGlobalSettings({generateAudioPeaks: value});
  }
}
