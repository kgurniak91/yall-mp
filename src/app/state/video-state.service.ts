import {computed, Injectable, Signal, signal} from '@angular/core';
import {VideoClip} from '../model/video.types';
import {VTTCue} from 'media-captions';

@Injectable({
  providedIn: 'root'
})
export class VideoStateService {
  private readonly _currentTime = signal(0);
  private readonly _duration = signal(0);
  private readonly _cues = signal<VTTCue[]>([]);

  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();
  public readonly duration: Signal<number> = this._duration.asReadonly();
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
