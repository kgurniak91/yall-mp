import {computed, DestroyRef, effect, inject, Injectable, signal} from '@angular/core';
import {AppStateService} from '../app/app-state.service';
import {
  AppTheme,
  CustomPathKey,
  ProjectSettings,
  SubtitleLookupBrowserType,
  SubtitleLookupService
} from '../../model/settings.types';
import {ToastService} from '../../shared/services/toast/toast.service';

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
  public readonly ankiInstantExport = computed(() => this.appStateService.globalSettings().ankiInstantExport);
  public readonly warnUnexportedNotes = computed(() => this.appStateService.globalSettings().warnUnexportedNotes);
  public readonly srtFontSizePx = computed(() => this.appStateService.globalSettings().srtFontSizePx);
  public readonly srtBackgroundOpacity = computed(() => this.appStateService.globalSettings().srtBackgroundOpacity);
  public readonly generateAudioPeaks = computed(() => this.appStateService.globalSettings().generateAudioPeaks);
  public readonly swapNavigationShortcuts = computed(() => this.appStateService.globalSettings().swapNavigationShortcuts);
  public readonly hardwareAcceleration = computed(() => this.appStateService.globalSettings().hardwareAcceleration);
  public readonly preferredAudioLanguages = computed(() => this.appStateService.globalSettings().preferredAudioLanguages);
  public readonly preferredSubtitleLanguages = computed(() => this.appStateService.globalSettings().preferredSubtitleLanguages);
  public readonly cinemaModeEnabled = computed(() => this.appStateService.globalSettings().cinemaModeEnabled);
  public readonly cinemaModeSpeed = computed(() => this.appStateService.globalSettings().cinemaModeSpeed);
  public readonly customMpvPath = computed(() => this.appStateService.globalSettings().customMpvPath || '');
  public readonly customFfmpegPath = computed(() => this.appStateService.globalSettings().customFfmpegPath || '');
  public readonly customFfprobePath = computed(() => this.appStateService.globalSettings().customFfprobePath || '');
  public readonly customAudiowaveformPath = computed(() => this.appStateService.globalSettings().customAudiowaveformPath || '');
  public readonly theme = computed(() => this.appStateService.globalSettings().theme ?? 'system');
  public readonly srtBackgroundColor = computed(() => `rgba(0, 0, 0, ${this.srtBackgroundOpacity()})`);
  public readonly settingsReloadTrigger = this._settingsReloadTrigger.asReadonly();
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const mediaQueryHandler = (e: MediaQueryListEvent) => this.applyDarkClass(this.theme(), e.matches);

    effect(() => {
      const theme = this.theme();
      window.electronAPI.appSetTheme(theme);
      this.applyDarkClass(theme, matchMedia.matches);
    });

    matchMedia.addEventListener('change', mediaQueryHandler);

    this.destroyRef.onDestroy(() => {
      matchMedia.removeEventListener('change', mediaQueryHandler);
    });
  }

  public setTheme(theme: AppTheme): void {
    this.appStateService.updateGlobalSettings({theme});
  }

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

  public setAnkiInstantExport(value: boolean): void {
    this.appStateService.updateGlobalSettings({ankiInstantExport: value});
  }

  public setWarnUnexportedNotes(value: boolean): void {
    this.appStateService.updateGlobalSettings({warnUnexportedNotes: value});
  }

  public setGenerateAudioPeaks(value: boolean): void {
    this.appStateService.updateGlobalSettings({generateAudioPeaks: value});
  }

  public setSwapNavigationShortcuts(value: boolean): void {
    this.appStateService.updateGlobalSettings({swapNavigationShortcuts: value});
  }

  public setHardwareAcceleration(value: boolean): void {
    this.appStateService.updateGlobalSettings({hardwareAcceleration: value});
  }

  public setPreferredAudioLanguages(languages: string[]): void {
    this.appStateService.updateGlobalSettings({preferredAudioLanguages: languages});
  }

  public setPreferredSubtitleLanguages(languages: string[]): void {
    this.appStateService.updateGlobalSettings({preferredSubtitleLanguages: languages});
  }

  public setCinemaModeEnabled(cinemaModeEnabled: boolean): void {
    this.appStateService.updateGlobalSettings({cinemaModeEnabled});
    this.toastService.info(`Switched to ${cinemaModeEnabled ? 'Cinema' : 'Study'} Mode`);
  }

  public setCinemaModeSpeed(value: number): void {
    this.appStateService.updateGlobalSettings({cinemaModeSpeed: value});
  }

  public setCustomPath(key: CustomPathKey, path: string): void {
    this.appStateService.updateGlobalSettings({[key]: path});
  }

  private applyDarkClass(theme: AppTheme, isSystemDark: boolean): void {
    const isDark = (theme === 'dark') || (theme === 'system' && isSystemDark);
    if (isDark) {
      document.documentElement.classList.add('app-dark');
    } else {
      document.documentElement.classList.remove('app-dark');
    }
  }
}
