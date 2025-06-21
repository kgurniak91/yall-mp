import {computed, Injectable, Signal, signal} from '@angular/core';
import {SeekType, VideoClip} from '../../model/video.types';
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

  public readonly videoElement: Signal<HTMLVideoElement | null> = this._videoElement.asReadonly();
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
  public readonly subtitlesVisible: Signal<boolean> = this._subtitlesVisible.asReadonly();
  public readonly seekRequest = this._seekRequest.asReadonly();
  public readonly playPauseRequest = this._playPauseRequest.asReadonly();
  public readonly repeatRequest = this._repeatRequest.asReadonly();
  public readonly forceContinueRequest = this._forceContinueRequest.asReadonly();

  public readonly clips: Signal<VideoClip[]> = computed(() => this.generateClips());
  public readonly clipsMap: Signal<Map<string, VideoClip>> = computed(() => {
    return new Map(this.clips().map(clip => [clip.id, clip]));
  });

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

  public setSubtitlesVisible(isVisible: boolean): void {
    this._subtitlesVisible.set(isVisible);
  }

  public togglePlayPause(): void {
    this._playPauseRequest.set(Date.now());
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
