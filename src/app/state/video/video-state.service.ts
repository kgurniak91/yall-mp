import {DestroyRef, inject, Injectable, Injector, OnDestroy, Signal, signal} from '@angular/core';
import {SeekType} from '../../model/video.types';
import {AppStateService} from '../app/app-state.service';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {auditTime, throttleTime} from 'rxjs';

@Injectable()
export class VideoStateService implements OnDestroy {
  private readonly _currentTime = signal(0);
  private readonly _duration = signal(0);
  private readonly _videoElement = signal<HTMLVideoElement | null>(null);
  private readonly _subtitlesVisible = signal(true);
  private readonly _seekRequest = signal<{ time: number; type: SeekType } | null>(null);
  private readonly _playPauseRequest = signal<number | null>(null);
  private readonly _repeatRequest = signal<number | null>(null);
  private readonly _forceContinueRequest = signal<number | null>(null);
  private readonly _toggleSettingsRequest = signal<number | null>(null);
  private readonly _editSubtitlesRequest = signal<number | null>(null);
  private readonly _syncTimelineRequest = signal<number | null>(null);
  private readonly _ankiExportRequest = signal<number | null>(null);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly appStateService = inject(AppStateService);
  private _projectId: string | null = null;

  public readonly videoElement: Signal<HTMLVideoElement | null> = this._videoElement.asReadonly();
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

  constructor() {
    window.electronAPI.onMpvEvent((status) => {
      console.log('mpv event', status);
      if (status.event === 'property-change') {
        switch(status.name) {
          case 'time-pos':
            this.setCurrentTime(status.data);
            break;
          case 'duration':
            this.setDuration(status.data);
            break;
          case 'pause':
            // TODO Handle pause state changes
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

  public setCurrentTime(time: number): void {
    this._currentTime.set(time);
  }

  public setDuration(duration: number): void {
    this._duration.set(duration);
  }

  public setVideoElement(element: HTMLVideoElement | null): void {
    this._videoElement.set(element);
  }

  public toggleSubtitlesVisible(): void {
    this._subtitlesVisible.update((isVisible) => !isVisible);
  }

  public setSubtitlesVisible(isVisible: boolean): void {
    this._subtitlesVisible.set(isVisible);
  }

  public togglePlayPause(): void {
    window.electronAPI.mpvCommand(['cycle', 'pause']);
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

  public repeatCurrentClip(): void {
    this._repeatRequest.set(Date.now());
  }

  public forceContinue(): void {
    this._forceContinueRequest.set(Date.now());
  }

  public seekRelative(time: number): void {
    window.electronAPI.mpvCommand(['seek', time, 'relative']);
    this._seekRequest.set({time, type: SeekType.Relative});
    this._syncTimelineRequest.set(Date.now());
  }

  public seekAbsolute(time: number): void {
    console.log(`[Renderer] VideoStateService: Sending "seek absolute" command to ${time}.`);
    window.electronAPI.mpvCommand(['seek', time, 'absolute']);
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

  private setupPeriodicSaving(): void {
    if (!this._projectId) {
      return;
    }

    toObservable(this.currentTime, {injector: this.injector}).pipe(
      auditTime(5000),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(currentTime => {
      if (this._projectId && this.duration() > 0) {
        this.appStateService.updateProject(this._projectId, {lastPlaybackTime: currentTime});
      }
    });
  }
}
