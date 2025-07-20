import {computed, Injectable, signal} from '@angular/core';
import {DEFAULT_PROJECT_SETTINGS, ProjectSettings} from '../../model/settings.types';

@Injectable()
export class ProjectSettingsStateService {
  private readonly _settings = signal<ProjectSettings>(DEFAULT_PROJECT_SETTINGS);

  public readonly settings = this._settings.asReadonly();
  public readonly autoPauseAtStart = computed(() => this.settings().autoPauseAtStart);
  public readonly autoPauseAtEnd = computed(() => this.settings().autoPauseAtEnd);
  public readonly subtitledClipSpeed = computed(() => this.settings().subtitledClipSpeed);
  public readonly gapSpeed = computed(() => this.settings().gapSpeed);
  public readonly subtitleBehavior = computed(() => this.settings().subtitleBehavior);

  public setSettings(projectSettings: ProjectSettings | undefined): void {
    this._settings.set(projectSettings ? {...projectSettings} : DEFAULT_PROJECT_SETTINGS);
  }
}
