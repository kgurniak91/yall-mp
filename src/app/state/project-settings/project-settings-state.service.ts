import {computed, inject, Injectable, signal} from '@angular/core';
import {DEFAULT_PROJECT_SETTINGS, ProjectSettings} from '../../model/settings.types';
import {AppStateService} from '../app/app-state.service';

@Injectable()
export class ProjectSettingsStateService {
  private readonly appStateService = inject(AppStateService);
  private readonly _isSettingsDrawerOpen = signal(false);

  public readonly settings = computed(() => {
    return this.appStateService.lastOpenedProject()?.settings ?? DEFAULT_PROJECT_SETTINGS;
  });
  public readonly autoPauseAtStart = computed(() => this.settings().autoPauseAtStart);
  public readonly autoPauseAtEnd = computed(() => this.settings().autoPauseAtEnd);
  public readonly subtitledClipSpeed = computed(() => this.settings().subtitledClipSpeed);
  public readonly gapSpeed = computed(() => this.settings().gapSpeed);
  public readonly subtitleBehavior = computed(() => this.settings().subtitleBehavior);
  public readonly selectedAudioTrackIndex = computed(() => this.settings().selectedAudioTrackIndex);
  public readonly useMpvSubtitles = computed(() => this.settings().useMpvSubtitles);
  public readonly subtitlesLanguage = computed(() => this.settings().subtitlesLanguage);
  public readonly isSettingsDrawerOpen = this._isSettingsDrawerOpen.asReadonly();

  public setSettings(projectSettings: Partial<ProjectSettings> | undefined): void {
    const project = this.appStateService.lastOpenedProject();
    if (project) {
      const newSettings = {...(project.settings ?? DEFAULT_PROJECT_SETTINGS), ...projectSettings};
      this.appStateService.updateProject(project.id, {settings: newSettings});
    }
  }

  public setSubtitlesVisible(isVisible: boolean): void {
    const project = this.appStateService.lastOpenedProject();
    if (project) {
      const newSettings = {...this.settings(), subtitlesVisible: isVisible};
      this.appStateService.updateProject(project.id, {settings: newSettings});
    }
  }

  public setSettingsDrawerOpen(isOpen: boolean): void {
    this._isSettingsDrawerOpen.set(isOpen);
  }
}
