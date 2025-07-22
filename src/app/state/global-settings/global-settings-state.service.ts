import {computed, inject, Injectable} from '@angular/core';
import {AppStateService} from '../app/app-state.service';
import {HiddenSubtitleStyle, ProjectSettings} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class GlobalSettingsStateService {
  private readonly appStateService = inject(AppStateService);

  public readonly boundaryAdjustAmountMs = computed(() => this.appStateService.globalSettings().boundaryAdjustAmountMs);
  public readonly seekAmountSeconds = computed(() => this.appStateService.globalSettings().seekAmountSeconds);
  public readonly hiddenSubtitleStyle = computed(() => this.appStateService.globalSettings().hiddenSubtitleStyle);
  public readonly defaultProjectSettings = computed(() => this.appStateService.globalSettings().defaultProjectSettings);

  public setBoundaryAdjustAmountMs(value: number): void {
    this.appStateService.updateGlobalSettings({boundaryAdjustAmountMs: value});
  }

  public setSeekAmountSeconds(value: number): void {
    this.appStateService.updateGlobalSettings({seekAmountSeconds: value});
  }

  public setHiddenSubtitleStyle(value: HiddenSubtitleStyle): void {
    this.appStateService.updateGlobalSettings({hiddenSubtitleStyle: value});
  }

  public setDefaultProjectSettings(newDefaults: ProjectSettings): void {
    const currentGlobalSettings = this.appStateService.globalSettings();
    this.appStateService.updateGlobalSettings({
      ...currentGlobalSettings,
      defaultProjectSettings: newDefaults
    });
  }
}
