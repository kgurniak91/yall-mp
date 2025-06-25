import {computed, inject, Injectable, Signal, signal} from '@angular/core';
import {VideoStateService} from '../video/video-state.service';
import {PlayerState, SeekDirection, VideoClip} from '../../model/video.types';
import {VTTCue} from 'media-captions';
import {SettingsStateService} from '../settings/settings-state.service';

const MIN_CLIP_DURATION = 0.1;
const ADJUST_DEBOUNCE_MS = 50;

@Injectable({
  providedIn: 'root'
})
export class ClipsStateService {
  private readonly videoStateService = inject(VideoStateService);
  private readonly settingsStateService = inject(SettingsStateService);
  private readonly _cues = signal<VTTCue[]>([]);
  private readonly _currentClipIndex = signal(0);
  private readonly _clipSelectedRequest = signal<{ index: number, timestamp: number } | null>(null);
  private readonly _playerState = signal<PlayerState>(PlayerState.Idle);
  private adjustDebounceTimer: any;

  public readonly currentClipIndex = this._currentClipIndex.asReadonly();
  public readonly clipSelectedRequest = this._clipSelectedRequest.asReadonly();
  public readonly playerState = this._playerState.asReadonly();

  public readonly isPlaying = computed(() => this.playerState() === PlayerState.Playing);
  public readonly clips: Signal<VideoClip[]> = computed(() => this.generateClips());
  public readonly currentClip = computed<VideoClip | undefined>(() => {
    return this.clips()[this.currentClipIndex()];
  });

  public setPlayerState(playerState: PlayerState): void {
    this._playerState.set(playerState);
  }

  public setCues(cues: VTTCue[]): void {
    this._cues.set(cues);
  }

  public selectClip(index: number): void {
    if (index >= 0 && index < this.clips().length) {
      this._currentClipIndex.set(index);
      this._clipSelectedRequest.set({index, timestamp: Date.now()});
    }
  }

  public clearClipSelectedRequest(): void {
    this._clipSelectedRequest.set(null);
  }

  public setCurrentClipByIndex(index: number): void {
    if (index >= 0 && index < this.clips().length) {
      this._currentClipIndex.set(index);
    }
  }

  public advanceToNextClip(): void {
    const nextIndex = this.currentClipIndex() + 1;
    if (nextIndex < this.clips().length) {
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

  public updateClipTimes(clipId: string, newStartTime: number, newEndTime: number): void {
    const allClips = this.clips();
    const clipIndex = allClips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return;

    const updatedClips = JSON.parse(JSON.stringify(allClips));
    const originalClip = updatedClips[clipIndex];
    let finalStartTime = newStartTime;
    let finalEndTime = newEndTime;

    if (originalClip.startTime.toFixed(4) !== finalStartTime.toFixed(4)) {
      const prevClip = updatedClips[clipIndex - 1];
      if (prevClip) {
        if (finalStartTime < prevClip.startTime + MIN_CLIP_DURATION) finalStartTime = prevClip.startTime + MIN_CLIP_DURATION;
        prevClip.endTime = finalStartTime;
      } else {
        if (finalStartTime < 0) finalStartTime = 0;
      }
    }

    if (originalClip.endTime.toFixed(4) !== finalEndTime.toFixed(4)) {
      const nextClip = updatedClips[clipIndex + 1];
      if (nextClip) {
        if (finalEndTime > nextClip.endTime - MIN_CLIP_DURATION) finalEndTime = nextClip.endTime - MIN_CLIP_DURATION;
        nextClip.startTime = finalEndTime;
      } else {
        const duration = this.videoStateService.duration();
        if (finalEndTime > duration) finalEndTime = duration;
      }
    }

    if (finalEndTime < finalStartTime + MIN_CLIP_DURATION) {
      finalEndTime = finalStartTime + MIN_CLIP_DURATION;
    }

    const targetClip = updatedClips[clipIndex];
    targetClip.startTime = finalStartTime;
    targetClip.endTime = finalEndTime;

    targetClip.duration = targetClip.endTime - targetClip.startTime;
    if (updatedClips[clipIndex - 1]) {
      updatedClips[clipIndex - 1].duration = updatedClips[clipIndex - 1].endTime - updatedClips[clipIndex - 1].startTime;
    }
    if (updatedClips[clipIndex + 1]) {
      updatedClips[clipIndex + 1].duration = updatedClips[clipIndex + 1].endTime - updatedClips[clipIndex + 1].startTime;
    }

    this.updateCuesFromClips(updatedClips);
  }

  public adjustCurrentClipBoundary(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    clearTimeout(this.adjustDebounceTimer);

    this.adjustDebounceTimer = setTimeout(() => {
      this.performAdjust(boundary, direction);
    }, ADJUST_DEBOUNCE_MS);
  }

  private performAdjust(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    const currentClip = this.currentClip();
    if (!currentClip) {
      return;
    }

    const adjustAmountSeconds = this.settingsStateService.adjustValueMs() / 1000;
    const directionMultiplier = (direction === 'left') ? -1 : 1;
    const changeAmount = adjustAmountSeconds * directionMultiplier;

    let newStartTime = currentClip.startTime;
    let newEndTime = currentClip.endTime;

    if (boundary === 'start') {
      newStartTime += changeAmount;
    } else { // boundary === 'end'
      newEndTime += changeAmount;
    }

    if (newStartTime < 0) {
      newStartTime = 0;
    }

    const totalDuration = this.videoStateService.duration();
    if (newEndTime > totalDuration) {
      newEndTime = totalDuration;
    }

    this.updateClipTimes(currentClip.id, newStartTime, newEndTime);
  }

  private findAdjacentSubtitleClip(direction: SeekDirection): VideoClip | undefined {
    const clips = this.clips();
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

  private updateCuesFromClips(updatedClips: VideoClip[]): void {
    const newCues: VTTCue[] = updatedClips
      .filter(clip => clip.hasSubtitle)
      .map(clip => {
        const newCue = new VTTCue(clip.startTime, clip.endTime, clip.text || '');
        const originalCueId = clip.id.startsWith('subtitle-') ? clip.id.substring('subtitle-'.length) : clip.id;
        newCue.id = originalCueId;
        return newCue;
      });
    this._cues.set(newCues);
  }

  private generateClips(): VideoClip[] {
    const cues = this._cues();
    const duration = this.videoStateService.duration();
    if (!duration) return [];

    const generatedClips: VideoClip[] = [];
    let lastTime = 0;

    cues.forEach((cue, index) => {
      if (cue.startTime > lastTime) {
        generatedClips.push({
          id: `gap-${index}`,
          startTime: lastTime,
          endTime: cue.startTime,
          duration: cue.startTime - lastTime,
          hasSubtitle: false
        });
      }
      generatedClips.push({
        id: `subtitle-${cue.id}`,
        startTime: cue.startTime,
        endTime: cue.endTime,
        duration: cue.endTime - cue.startTime,
        text: cue.text,
        hasSubtitle: true
      });
      lastTime = cue.endTime;
    });

    if (lastTime < duration) {
      generatedClips.push({
        id: `gap-final`,
        startTime: lastTime,
        endTime: duration,
        duration: duration - lastTime,
        hasSubtitle: false
      });
    }
    return generatedClips;
  }
}
