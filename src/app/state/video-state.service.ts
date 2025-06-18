import {computed, Injectable, Signal, signal} from '@angular/core';
import {SeekDirection, SeekType, VideoClip} from '../model/video.types';
import {VTTCue} from 'media-captions';

const MIN_CLIP_DURATION = 0.1;

@Injectable({
  providedIn: 'root'
})
export class VideoStateService {
  private readonly _currentTime = signal(0);
  private readonly _duration = signal(0);
  private readonly _cues = signal<VTTCue[]>([]);
  private readonly _videoElement = signal<HTMLVideoElement | null>(null);
  private readonly _subtitlesVisible = signal(true);
  private readonly _seekRequest = signal<{ time: number; type: SeekType } | null>(null);
  private readonly _playPauseRequest = signal<number | null>(null);
  private readonly _repeatRequest = signal<number | null>(null);
  private readonly _forceContinueRequest = signal<number | null>(null);
  private readonly _lastActiveSubtitleClipId = signal<string | null>(null);
  private readonly _autoPauseAtStart = signal(true);
  private readonly _autoPauseAtEnd = signal(true);
  private readonly _isPlayerPaused = signal(true);
  private readonly _isAutoPaused = signal(false);

  public readonly videoElement: Signal<HTMLVideoElement | null> = this._videoElement.asReadonly();
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
  public readonly subtitlesVisible: Signal<boolean> = this._subtitlesVisible.asReadonly();
  public readonly seekRequest = this._seekRequest.asReadonly();
  public readonly playPauseRequest = this._playPauseRequest.asReadonly();
  public readonly lastActiveSubtitleClipId = this._lastActiveSubtitleClipId.asReadonly();
  public readonly autoPauseAtStart = this._autoPauseAtStart.asReadonly();
  public readonly autoPauseAtEnd = this._autoPauseAtEnd.asReadonly();
  public readonly repeatRequest = this._repeatRequest.asReadonly();
  public readonly forceContinueRequest = this._forceContinueRequest.asReadonly();
  public readonly isPlayerPaused = this._isPlayerPaused.asReadonly();
  public readonly isAutoPaused = this._isAutoPaused.asReadonly();

  public readonly clips: Signal<VideoClip[]> = computed(() => this.generateClips());
  public readonly clipsMap: Signal<Map<string, VideoClip>> = computed(() => {
    return new Map(this.clips().map(clip => [clip.id, clip]));
  });
  public readonly currentClip: Signal<VideoClip | undefined> = computed(() => {
    const time = this.currentTime();
    return this.clips().find(clip => time >= clip.startTime && time < clip.endTime);
  });
  public readonly lastActiveSubtitleClip = computed(() => {
    const id = this.lastActiveSubtitleClipId();
    return id ? this.clipsMap().get(id) : null;
  });

  public setPlayerPausedState(isPaused: boolean): void {
    this._isPlayerPaused.set(isPaused);
    if (!isPaused) {
      this._isAutoPaused.set(false);
    }
  }

  public setAutoPaused(isAutoPaused: boolean): void {
    this._isAutoPaused.set(isAutoPaused);
  }

  public setCurrentTime(time: number): void {
    this._currentTime.set(time);
  }

  public setDuration(duration: number): void {
    this._duration.set(duration);
  }

  public setCues(cues: VTTCue[]): void {
    this._cues.set(cues);
  }

  public setVideoElement(element: HTMLVideoElement | null): void {
    this._videoElement.set(element);
  }

  public toggleSubtitlesVisible(): void {
    this._subtitlesVisible.update((isVisible) => !isVisible);
  }

  public toggleAutoPauseAtStart(): void {
    this._autoPauseAtStart.update((isTrue) => !isTrue);
  }

  public toggleAutoPauseAtEnd(): void {
    this._autoPauseAtEnd.update((isTrue) => !isTrue);
  }

  public togglePlayPause(): void {
    if (this.isPlayerPaused() && this.isAutoPaused()) {
      this.setAutoPaused(false);
    }
    this._playPauseRequest.set(Date.now());
  }

  public repeatLastClip(): void {
    if (this.lastActiveSubtitleClipId()) {
      this._repeatRequest.set(Date.now());
    }
  }

  public forceContinue(): void {
    this._forceContinueRequest.set(Date.now());
  }

  public setLastActiveSubtitleClipId(clipId: string | null): void {
    if (this._lastActiveSubtitleClipId() !== clipId) {
      this._lastActiveSubtitleClipId.set(clipId);
    }
  }

  public recalculateActiveClip(): void {
    const clip = this.currentClip();
    if (clip?.hasSubtitle) {
      this.setLastActiveSubtitleClipId(clip.id);
    } else {
      // Do not clear to allow repeat from a gap
      // Cleared when new subtitle clip is entered
    }
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

  public goToAdjacentSubtitleClip(direction: SeekDirection): void {
    const adjacentClip = this.findAdjacentSubtitleClip(direction);
    if (adjacentClip) {
      this.seekAbsolute(adjacentClip.startTime);
    } else if (direction === SeekDirection.Previous) {
      const currentSubtitleClip = this.lastActiveSubtitleClip();
      if (currentSubtitleClip) {
        this.seekAbsolute(currentSubtitleClip.startTime);
      }
    }
  }

  public findAdjacentSubtitleClip(direction: SeekDirection): VideoClip | undefined {
    const clips = this.clips();
    if (clips.length === 0) return undefined;

    // Use last active subtitle clip as reference
    // Fallback to current clip
    const referenceClip = this.lastActiveSubtitleClip() ?? this.currentClip();
    if (!referenceClip) return undefined;

    const currentIndex = clips.findIndex(c => c.id === referenceClip.id);
    if (currentIndex === -1) return undefined; // Safety check

    if (direction === SeekDirection.Next) {
      // Search for next subtitle clip
      for (let i = currentIndex + 1; i < clips.length; i++) {
        if (clips[i].hasSubtitle) return clips[i];
      }
    } else { // Previous
      // Search for previous subtitle clip
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (clips[i].hasSubtitle) return clips[i];
      }
    }

    return undefined; // No adjacent subtitle clip found
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
        const duration = this.duration();
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
    const duration = this._duration();
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
