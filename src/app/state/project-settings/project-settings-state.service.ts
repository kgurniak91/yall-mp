import {computed, Injectable, signal} from '@angular/core';
import {
  DEFAULT_PROJECT_SETTINGS,
  HiddenSubtitleStyle,
  ProjectSettings,
  SubtitleBehavior
} from '../../model/settings.types';

@Injectable()
export class ProjectSettingsStateService {
  private readonly _settings = signal<ProjectSettings>(DEFAULT_PROJECT_SETTINGS);

  public readonly settings = this._settings.asReadonly();
  public readonly autoPauseAtStart = computed(() => this.settings().autoPauseAtStart);
  public readonly autoPauseAtEnd = computed(() => this.settings().autoPauseAtEnd);
  public readonly subtitledClipSpeed = computed(() => this.settings().subtitledClipSpeed);
  public readonly gapSpeed = computed(() => this.settings().gapSpeed);
  public readonly subtitleBehavior = computed(() => this.settings().subtitleBehavior);
  public readonly adjustValueMs = computed(() => this.settings().adjustValueMs);
  public readonly seekSeconds = computed(() => this.settings().seekSeconds);
  public readonly hiddenSubtitleStyle = computed(() => this.settings().hiddenSubtitleStyle);

  public loadSettings(projectSettings: ProjectSettings | undefined): void {
    this._settings.set(projectSettings ? {...projectSettings} : DEFAULT_PROJECT_SETTINGS);
  }

  public setAutoPauseAtStart(value: boolean): void {
    this._settings.update(s => ({...s, autoPauseAtStart: value}));
  }

  public setAutoPauseAtEnd(value: boolean): void {
    this._settings.update(s => ({...s, autoPauseAtEnd: value}));
  }

  public setSubtitledClipSpeed(value: number): void {
    this._settings.update(s => ({...s, subtitledClipSpeed: value}));
  }

  public setGapSpeed(value: number): void {
    this._settings.update(s => ({...s, gapSpeed: value}));
  }

  public setSubtitleBehavior(value: SubtitleBehavior): void {
    this._settings.update(s => ({...s, subtitleBehavior: value}));
  }

  public setAdjustValueMs(value: number): void {
    this._settings.update(s => ({...s, adjustValueMs: value}));
  }

  public setSeekSeconds(value: number): void {
    this._settings.update(s => ({...s, seekSeconds: value}));
  }

  public setHiddenSubtitleStyle(value: HiddenSubtitleStyle): void {
    this._settings.update(s => ({...s, hiddenSubtitleStyle: value}));
  }
}
