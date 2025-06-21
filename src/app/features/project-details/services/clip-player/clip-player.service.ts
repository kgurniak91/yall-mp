import {computed, inject, Injectable, signal} from '@angular/core';
import {VideoStateService} from '../../../../state/video/video-state.service';
import {PlayerState, SeekDirection, VideoClip} from '../../../../model/video.types';

@Injectable({
  providedIn: 'root'
})
export class ClipPlayerService {
  private readonly videoStateService = inject(VideoStateService);
  private readonly _currentClipIndex = signal(0);
  private readonly _clipSelectedRequest = signal<{ index: number, timestamp: number } | null>(null);
  private readonly _playerState = signal<PlayerState>(PlayerState.Idle);

  public readonly currentClipIndex = this._currentClipIndex.asReadonly();
  public readonly clipSelectedRequest = this._clipSelectedRequest.asReadonly();
  public readonly playerState = this._playerState.asReadonly();

  public readonly isPlaying = computed(() => this.playerState() === PlayerState.Playing);
  public readonly currentClip = computed<VideoClip | undefined>(() => {
    return this.videoStateService.clips()[this.currentClipIndex()];
  });
  public readonly nextClip = computed<VideoClip | undefined>(() => {
    return this.videoStateService.clips()[this.currentClipIndex() + 1];
  });
  public readonly previousClip = computed<VideoClip | undefined>(() => {
    return this.videoStateService.clips()[this.currentClipIndex() - 1];
  });

  public setPlayerState(playerState: PlayerState): void {
    this._playerState.set(playerState);
  }

  public selectClip(index: number): void {
    if (index >= 0 && index < this.videoStateService.clips().length) {
      this._currentClipIndex.set(index);
      this._clipSelectedRequest.set({index, timestamp: Date.now()});
    }
  }

  public clearClipSelectedRequest(): void {
    this._clipSelectedRequest.set(null);
  }

  public setCurrentClipByIndex(index: number): void {
    if (index >= 0 && index < this.videoStateService.clips().length) {
      this._currentClipIndex.set(index);
    }
  }

  public advanceToNextClip(): void {
    const nextIndex = this.currentClipIndex() + 1;
    if (nextIndex < this.videoStateService.clips().length) {
      this._currentClipIndex.set(nextIndex);
    } else {
      this._playerState.set(PlayerState.Idle); // Reached the end
    }
  }

  public goToAdjacentSubtitleClip(direction: SeekDirection): void {
    const adjacentClip = this.findAdjacentSubtitleClip(direction);
    if (adjacentClip) {
      this.videoStateService.seekAbsolute(adjacentClip.startTime);
    } else if (direction === SeekDirection.Previous) {
      const current = this.currentClip();
      if (current?.hasSubtitle) {
        this.videoStateService.seekAbsolute(current.startTime);
      }
    }
  }

  private findAdjacentSubtitleClip(direction: SeekDirection): VideoClip | undefined {
    const clips = this.videoStateService.clips();
    if (clips.length === 0) {
      return undefined;
    }

    const currentIndex = this.currentClipIndex();
    const referenceClip = clips[currentIndex];
    if (!referenceClip) {
      return undefined;
    }

    if (direction === SeekDirection.Next) {
      for (let i = currentIndex + 1; i < clips.length; i++) {
        if (clips[i].hasSubtitle) {
          return clips[i];
        }
      }
      return undefined; // No next subtitle clip found
    }

    if (direction === SeekDirection.Previous) {
      // find the index of the PREVIOUS subtitle clip by searching backwards.
      let previousSubtitleIndex = -1;
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (clips[i].hasSubtitle) {
          previousSubtitleIndex = i;
          break;
        }
      }

      // If there is no previous subtitle clip, the player is at the start.
      // In this case, the target is the current clip.
      if (previousSubtitleIndex === -1) {
        const currentClip = clips[currentIndex];
        // Only return the current clip if it has a subtitle.
        return currentClip?.hasSubtitle ? currentClip : undefined;
      }

      // Otherwise, return the found previous subtitle clip.
      return clips[previousSubtitleIndex];
    }

    return undefined; // No adjacent subtitle clip was found
  }
}
