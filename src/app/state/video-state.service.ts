import {computed, Injectable, Signal, signal} from '@angular/core';
import {SeekDirection, SeekType, VideoClip} from '../model/video.types';
import {VTTCue} from 'media-captions';

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
  private readonly _playPauseRequest = signal<number | null>(null); // Use timestamp to ensure it's a new request
  private readonly _repeatRequest = signal<number | null>(null);
  private readonly _forceContinueRequest = signal<number | null>(null);
  private readonly _lastActiveSubtitleClipId = signal<string | null>(null);
  private readonly _autoPauseAtStart = signal(false);
  private readonly _autoPauseAtEnd = signal(true);

  public readonly videoElement: Signal<HTMLVideoElement | null> = this._videoElement.asReadonly();
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
  public readonly subtitlesVisible: Signal<boolean> = this._subtitlesVisible.asReadonly();
  public readonly seekRequest = this._seekRequest.asReadonly();
  public readonly playPauseRequest = this._playPauseRequest.asReadonly();
  public readonly lastActiveSubtitleClip = computed(() => {
    const id = this._lastActiveSubtitleClipId();
    if (id) {
      return this.clips().find(clip => clip.id === id);
    } else {
      return null;
    }
  });
  public readonly autoPauseAtStart = this._autoPauseAtStart.asReadonly();
  public readonly autoPauseAtEnd = this._autoPauseAtEnd.asReadonly();
  public readonly repeatRequest = this._repeatRequest.asReadonly();
  public readonly forceContinueRequest = this._forceContinueRequest.asReadonly();

  public readonly clips: Signal<VideoClip[]> = computed(() => this.generateClips());
  public readonly currentClip: Signal<VideoClip | undefined> = computed(() => {
    const time = this.currentTime();
    return this.clips().find(clip => time >= clip.startTime && time < clip.endTime);
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
    this._subtitlesVisible.update((subtitlesVisible: boolean) => !subtitlesVisible);
  }

  public toggleAutoPauseAtStart(): void {
    this._autoPauseAtStart.update((autoPauseAtStart: boolean) => !autoPauseAtStart);
  }

  public toggleAutoPauseAtEnd(): void {
    this._autoPauseAtEnd.update((autoPauseAtEnd: boolean) => !autoPauseAtEnd);
  }

  public togglePlayPause(): void {
    this._playPauseRequest.set(Date.now());
  }

  public repeatLastClip(): void {
    // Only issue a repeat request if there's a clip to repeat.
    if (this._lastActiveSubtitleClipId()) {
      this._repeatRequest.set(Date.now());
    }
  }

  public clearRepeatRequest(): void {
    this._repeatRequest.set(null);
  }

  public forceContinue(): void {
    this._forceContinueRequest.set(Date.now());
  }

  public setLastActiveSubtitleClipId(clipId: string | null): void {
    this._lastActiveSubtitleClipId.set(clipId);
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

  public goToAdjacentSubtitleClip(direction: SeekDirection): void {
    const adjacentClip = this.findAdjacentClip(direction);
    if (adjacentClip) {
      this.seekAbsolute(adjacentClip.startTime);
    }
  }

  public updateClipTimes(clipId: string, newStartTime: number, newEndTime: number): void {
    const allClips = this.clips(); 
    const clipIndex = allClips.findIndex(c => c.id === clipId);

    if (clipIndex === -1) {
      console.error('Could not find clip to update:', clipId);
      return;
    }

    const originalClip = allClips[clipIndex];
    const updatedClips = [...allClips]; // Create a mutable copy

    let finalStartTime = newStartTime;
    let finalEndTime = newEndTime;

    // --- Collision and Boundary Logic ---

    // Update previous clip's end time if start changed
    if (originalClip.startTime !== finalStartTime) {
      const prevClip = updatedClips[clipIndex - 1];
      if (prevClip) {
        // Prevent dragging start time before the previous clip's start time
        if (finalStartTime < prevClip.startTime) {
          finalStartTime = prevClip.startTime;
        }
        prevClip.endTime = finalStartTime;
        prevClip.duration = prevClip.endTime - prevClip.startTime;
      } else {
        // This is the first clip, it can't start before 0
        if (finalStartTime < 0) finalStartTime = 0;
      }
    }

    // Update next clip's start time if end changed
    if (originalClip.endTime !== finalEndTime) {
      const nextClip = updatedClips[clipIndex + 1];
      if (nextClip) {
        // Prevent dragging end time after the next clip's end time
        if (finalEndTime > nextClip.endTime) {
          finalEndTime = nextClip.endTime;
        }
        nextClip.startTime = finalEndTime;
        nextClip.duration = nextClip.endTime - nextClip.startTime;
      } else {
        // This is the last clip, it can't end after the total duration
        const duration = this.duration();
        if (finalEndTime > duration) finalEndTime = duration;
      }
    }

    // Ensure the clip itself doesn't have a negative duration
    if (finalEndTime < finalStartTime) {
      // Handle inverted edges (negative duration)
      
      [finalStartTime, finalEndTime] = [finalEndTime, finalStartTime];
    }

    // Update the target clip
    const targetClip = updatedClips[clipIndex];
    targetClip.startTime = finalStartTime;
    targetClip.endTime = finalEndTime;
    targetClip.duration = targetClip.endTime - targetClip.startTime;

    // Sync changes back to source cues
    
    this.updateCuesFromClips(updatedClips);
  }

  public findAdjacentClip(direction: SeekDirection): VideoClip | undefined {
    const clips = this.clips();
    const currentTime = this.currentTime();
    if (clips.length === 0) return undefined;

    // Find the index of the current clip
    const currentIndex = clips.findIndex(c => currentTime >= c.startTime && currentTime < c.endTime);
    if (currentIndex === -1) return undefined;

    // Search forwards or backwards from the current index
    if (direction === SeekDirection.Next) {
      for (let i = currentIndex + 1; i < clips.length; i++) {
        if (clips[i].hasSubtitle) return clips[i];
      }
    } else {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (clips[i].hasSubtitle) return clips[i];
      }
    }

    return undefined; // No next/previous subtitle clip found
  }

  /**
   * Helper to reverse-engineer the VideoClip[] array back into a VTTCue[] array.
   * This will trigger the `clips` computed signal to update automatically.
   */
  private updateCuesFromClips(updatedClips: VideoClip[]): void {
    const newCues: VTTCue[] = updatedClips
      .filter(clip => clip.hasSubtitle)
      .map(clip => {
        
        const newCue = new VTTCue(clip.startTime, clip.endTime, clip.text || '');

        // Manually assign the old, stable ID to the new cue object.
        newCue.id = clip.id;

        return newCue;
      });

    this._cues.set(newCues);
  }

  private generateClips(): VideoClip[] {
    const cues = this._cues();
    const duration = this._duration();
    if (!duration) return []; // Don't generate clips until video length is known

    const generatedClips: VideoClip[] = [];
    let lastTime = 0;

    cues.forEach((cue, index) => {
      // Create a "gap" clip if there's space between the last clip and this one
      if (cue.startTime > lastTime) {
        generatedClips.push({
          id: `gap-${index}`,
          startTime: lastTime,
          endTime: cue.startTime,
          duration: cue.startTime - lastTime,
          hasSubtitle: false
        });
      }

      // Create the clip for the actual subtitle
      generatedClips.push({
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        duration: cue.endTime - cue.startTime,
        text: cue.text,
        hasSubtitle: true
      });

      lastTime = cue.endTime;
    });

    // Create the final "gap" clip from the end of the last subtitle to the end of the video
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
