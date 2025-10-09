import {computed, inject, Injectable} from '@angular/core';
import {AppStateService} from '../app/app-state.service';
import {ProjectSettings} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class GlobalSettingsStateService {
  private readonly appStateService = inject(AppStateService);

  public readonly boundaryAdjustAmountMs = computed(() => this.appStateService.globalSettings().boundaryAdjustAmountMs);
  public readonly seekAmountSeconds = computed(() => this.appStateService.globalSettings().seekAmountSeconds);
  public readonly defaultProjectSettings = computed(() => this.appStateService.globalSettings().defaultProjectSettings);
  public readonly srtFontSizePx = computed(() => this.appStateService.globalSettings().srtFontSizePx);
  public readonly srtBackgroundOpacity = computed(() => this.appStateService.globalSettings().srtBackgroundOpacity);
  public readonly srtBackgroundColor = computed(() => `rgba(0, 0, 0, ${this.srtBackgroundOpacity()})`);

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

}
