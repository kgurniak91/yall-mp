import {Injectable, Signal, signal} from '@angular/core';
import {SeekType} from '../../model/video.types';

@Injectable({
  providedIn: 'root'
})
export class VideoStateService {
  private readonly _currentTime = signal(0);
  private readonly _duration = signal(0);
  private readonly _videoElement = signal<HTMLVideoElement | null>(null);
  private readonly _subtitlesVisible = signal(true);
  private readonly _seekRequest = signal<{ time: number; type: SeekType } | null>(null);
  private readonly _playPauseRequest = signal<number | null>(null);
  private readonly _repeatRequest = signal<number | null>(null);
  private readonly _forceContinueRequest = signal<number | null>(null);
  private readonly _toggleSettingsRequest = signal<number | null>(null);

  public readonly videoElement: Signal<HTMLVideoElement | null> = this._videoElement.asReadonly();
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
  public readonly subtitlesVisible: Signal<boolean> = this._subtitlesVisible.asReadonly();
  public readonly seekRequest = this._seekRequest.asReadonly();
  public readonly playPauseRequest = this._playPauseRequest.asReadonly();
  public readonly repeatRequest = this._repeatRequest.asReadonly();
  public readonly forceContinueRequest = this._forceContinueRequest.asReadonly();
  public readonly toggleSettingsRequest = this._toggleSettingsRequest.asReadonly();

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
    this._playPauseRequest.set(Date.now());
  }

  public toggleSettings(): void {
    this._toggleSettingsRequest.set(Date.now());
  }

  public repeatCurrentClip(): void {
    this._repeatRequest.set(Date.now());
  }

  public forceContinue(): void {
    this._forceContinueRequest.set(Date.now());
  }

  public seekRelative(time: number): void {
    this._seekRequest.set({time, type: SeekType.Relative});
  }

  public seekAbsolute(time: number): void {
    this._seekRequest.set({time, type: SeekType.Absolute});
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
}
