import {computed, inject, Injectable} from '@angular/core';
import {ProjectsStateService} from '../projects/projects-state.service';
import {HiddenSubtitleStyle, ProjectSettings} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class GlobalSettingsStateService {
  private readonly projectsState = inject(ProjectsStateService);

  public readonly boundaryAdjustAmountMs = computed(() => this.projectsState.globalSettings().boundaryAdjustAmountMs);
  public readonly seekAmountSeconds = computed(() => this.projectsState.globalSettings().seekAmountSeconds);
  public readonly hiddenSubtitleStyle = computed(() => this.projectsState.globalSettings().hiddenSubtitleStyle);
  public readonly defaultProjectSettings = computed(() => this.projectsState.globalSettings().defaultProjectSettings);

  public setBoundaryAdjustAmountMs(value: number): void {
    this.projectsState.updateGlobalSettings({boundaryAdjustAmountMs: value});
  }

  public setSeekAmountSeconds(value: number): void {
    this.projectsState.updateGlobalSettings({seekAmountSeconds: value});
  }

  public setHiddenSubtitleStyle(value: HiddenSubtitleStyle): void {
    this.projectsState.updateGlobalSettings({hiddenSubtitleStyle: value});
  }

  public setDefaultProjectSettings(newDefaults: ProjectSettings): void {
    const currentGlobalSettings = this.projectsState.globalSettings();
    this.projectsState.updateGlobalSettings({
      ...currentGlobalSettings,
      defaultProjectSettings: newDefaults
    });
  }
}
