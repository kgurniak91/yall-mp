import {DestroyRef, inject, Injectable, Injector, OnDestroy, Signal, signal} from '@angular/core';
import {SeekType} from '../../model/video.types';
import {AppStateService} from '../app/app-state.service';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {auditTime} from 'rxjs';

@Injectable()
export class VideoStateService implements OnDestroy {
  private readonly _currentTime = signal(0);
  private readonly _duration = signal(0);
  private readonly _mediaPath = signal<string | null>(null);
  private readonly _subtitlesVisible = signal(true);
  private readonly _seekRequest = signal<{ time: number; type: SeekType } | null>(null);
  private readonly _playPauseRequest = signal<number | null>(null);
  private readonly _repeatRequest = signal<number | null>(null);
  private readonly _forceContinueRequest = signal<number | null>(null);
  private readonly _toggleSettingsRequest = signal<number | null>(null);
  private readonly _editSubtitlesRequest = signal<number | null>(null);
  private readonly _syncTimelineRequest = signal<number | null>(null);
  private readonly _ankiExportRequest = signal<number | null>(null);
  private readonly _forceResizeRequest = signal<number | null>(null);
  private readonly _isPaused = signal(true);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly appStateService = inject(AppStateService);
  private _projectId: string | null = null;
  private ignoreNextTimeUpdate = false;

  public readonly mediaPath: Signal<string | null> = this._mediaPath.asReadonly();
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
  public readonly subtitlesVisible: Signal<boolean> = this._subtitlesVisible.asReadonly();
  public readonly seekRequest = this._seekRequest.asReadonly();
  public readonly playPauseRequest = this._playPauseRequest.asReadonly();
  public readonly repeatRequest = this._repeatRequest.asReadonly();
  public readonly forceContinueRequest = this._forceContinueRequest.asReadonly();
  public readonly toggleSettingsRequest = this._toggleSettingsRequest.asReadonly();
  public readonly editSubtitlesRequest = this._editSubtitlesRequest.asReadonly();
  public readonly syncTimelineRequest = this._syncTimelineRequest.asReadonly();
  public readonly ankiExportRequest = this._ankiExportRequest.asReadonly();
  public readonly forceResizeRequest = this._forceResizeRequest.asReadonly();
  public readonly isPaused = this._isPaused.asReadonly();

  constructor() {
    window.electronAPI.onMpvEvent((status) => {
      console.log('mpv event', status);

      // Set a flag when a seek or restart occurs, as the next time update may be inaccurate.
      if (status.event === 'playback-restart' || status.event === 'seek') {
        this.ignoreNextTimeUpdate = true;
        return;
      }

      if (status.event === 'property-change') {
        switch (status.name) {
          case 'time-pos':
            if (this.ignoreNextTimeUpdate) {
              this.ignoreNextTimeUpdate = false;
              break;
            }

            this.setCurrentTime(status.data);
            break;
          case 'duration':
            this.setDuration(status.data);
            break;
          case 'pause':
            this._isPaused.set(status.data);
            break;
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (!this._projectId) {
      return;
    }

    this.appStateService.updateProject(this._projectId, {
      lastPlaybackTime: this.currentTime()
    });
  }

  public setProjectId(id: string): void {
    this._projectId = id;
    this.setupPeriodicSaving();
  }

  public setMediaPath(path: string): void {
    this._mediaPath.set(path);
  }

  public setCurrentTime(time: number): void {
    if (time != null && isFinite(time)) {
      this._currentTime.set(time);
    }
  }

  public setDuration(duration: number): void {
    // Ignore invalid duration to prevent flickering
    if ((duration == null || duration <= 0) && this._duration() > 0) {
      return;
    }
    this._duration.set(duration);
  }

  public toggleSubtitlesVisible(): void {
    this._subtitlesVisible.update((isVisible) => !isVisible);
  }

  public setSubtitlesVisible(isVisible: boolean): void {
    this._subtitlesVisible.set(isVisible);
  }

  public togglePlayPause(): void {
    this._playPauseRequest.set(Date.now());
  }

  public toggleSettings(): void {
    this._toggleSettingsRequest.set(Date.now());
  }

  public requestEditSubtitles(): void {
    this._editSubtitlesRequest.set(Date.now());
  }

  public requestAnkiExport(): void {
    this._ankiExportRequest.set(Date.now());
  }

  public requestForceResize(): void {
    this._forceResizeRequest.set(Date.now());
  }

  public repeatCurrentClip(): void {
    this._repeatRequest.set(Date.now());
  }

  public forceContinue(): void {
    this._forceContinueRequest.set(Date.now());
  }

  public seekRelative(time: number): void {
    this._seekRequest.set({time, type: SeekType.Relative});
    this._syncTimelineRequest.set(Date.now());
  }

  public seekAbsolute(time: number): void {
    this._seekRequest.set({time, type: SeekType.Absolute});
    this._syncTimelineRequest.set(Date.now());
  }

  public clearSeekRequest(): void {
    this._seekRequest.set(null);
  }

  public clearRepeatRequest(): void {
    this._repeatRequest.set(null);
  }

  public clearPlayPauseRequest(): void {
    this._playPauseRequest.set(null);
  }

  public clearForceContinueRequest(): void {
    this._forceContinueRequest.set(null);
  }

  public clearToggleSettingsRequest(): void {
    this._toggleSettingsRequest.set(null);
  }

  public clearEditSubtitlesRequest(): void {
    this._editSubtitlesRequest.set(null);
  }

  public clearAnkiExportRequest(): void {
    this._ankiExportRequest.set(null);
  }

  public clearForceResizeRequest(): void {
    this._forceResizeRequest.set(null);
  }

  public saveCurrentPlaybackTime(): void {
    if (this._projectId && this.duration() > 0) {
      this.appStateService.updateProject(this._projectId, {lastPlaybackTime: this.currentTime()});
    }
  }

  private setupPeriodicSaving(): void {
    if (!this._projectId) {
      return;
    }

    toObservable(this.currentTime, {injector: this.injector}).pipe(
      auditTime(5000),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(currentTime => this.saveCurrentPlaybackTime());
  }
}
