import {computed, inject, Injectable, signal} from '@angular/core';
import {VideoStateService} from '../../../../state/video/video-state.service';
import {SettingsStateService} from '../../../../state/settings/settings-state.service';
import {VideoClip} from '../../../../model/video.types';

@Injectable({
  providedIn: 'root'
})
export class ClipPlayerService {
  private videoStateService = inject(VideoStateService);
  private settingsStateService = inject(SettingsStateService);

  // Conductor state
  readonly currentClipIndex = signal(0);
  readonly isPlaying = signal(false);

  
  readonly clips = this.videoStateService.clips;
  readonly currentClip = computed<VideoClip | undefined>(() => {
    return this.clips()[this.currentClipIndex()];
  });

  public playClip(index: number): void {
    if (index < 0 || index >= this.clips().length) {
      this.isPlaying.set(false);
      return;
    }
    this.currentClipIndex.set(index);
    this.isPlaying.set(true);
    
  }

  public pause(): void {
    this.isPlaying.set(false);
  }

  public playCurrent(): void {
    this.isPlaying.set(true);
  }

  public playNext(): void {
    this.playClip(this.currentClipIndex() + 1);
  }

  public playPrevious(): void {
    this.playClip(this.currentClipIndex() - 1);
  }

  
  public onClipFinished(): void {
    const clipJustFinished = this.currentClip();
    if (!clipJustFinished) return;

    
    const autoPauseAtEnd = this.settingsStateService.autoPauseAtEnd();
    const autoPauseAtStart = this.settingsStateService.autoPauseAtStart();
    const nextClip = this.clips()[this.currentClipIndex() + 1];

    if (clipJustFinished.hasSubtitle && autoPauseAtEnd) {
      this.pause();
    } else if (!clipJustFinished.hasSubtitle && nextClip?.hasSubtitle && autoPauseAtStart) {
      this.pause();
    } else {
      this.playNext();
    }
  }
}
