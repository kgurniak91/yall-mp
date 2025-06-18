import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  viewChild,
  ViewEncapsulation
} from '@angular/core';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import {VideoJsOptions} from './video-player.type';
import {VideoStateService} from '../../../state/video-state.service';
import {SeekType, VideoClip} from '../../../model/video.types';

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
  encapsulation: ViewEncapsulation.None
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  videoElementRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  options = input.required<VideoJsOptions>();
  private player: Player | undefined;
  private videoStateService = inject(VideoStateService);

  private scheduledPauseTimeout: any;
  private lastScheduledPauseClipId: string | null = null;
  private isSeeking = false;
  private justPlayedFromAutoPause = false;

  private requestHandler = effect(() => {
    const playPauseRequest = this.videoStateService.playPauseRequest();
    if (playPauseRequest) this.handleTogglePlayPause();

    const repeatRequest = this.videoStateService.repeatRequest();
    if (repeatRequest) this.handleRepeat();

    const seekRequest = this.videoStateService.seekRequest();
    if (seekRequest) this.handleSeek(seekRequest);

    const forceContinueRequest = this.videoStateService.forceContinueRequest();
    if (forceContinueRequest) this.handleForceContinue();
  });

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;
    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.on('timeupdate', () => this.onTimeUpdate());
      this.player?.on('play', () => this.videoStateService.setPlayerPausedState(false));
      this.player?.on('pause', () => this.videoStateService.setPlayerPausedState(true));
      this.player?.on('seeking', () => {
        this.isSeeking = true;
        this.clearScheduledPause();
      });
      this.player?.on('seeked', () => {
        this.isSeeking = false;
        this.onTimeUpdate();
      });
      this.player?.on('loadedmetadata', () => this.videoStateService.setDuration(this.player?.duration() || 0));
    });
  }

  ngOnDestroy() {
    this.clearScheduledPause();
    if (this.player) this.player.dispose();
  }

  private onTimeUpdate(): void {
    if (!this.player || this.isSeeking) return;

    if (this.justPlayedFromAutoPause) {
      this.justPlayedFromAutoPause = false;
      return;
    }

    const currentTime = this.player.currentTime() || 0;
    this.videoStateService.setCurrentTime(currentTime);

    const currentClip = this.videoStateService.currentClip();
    if (currentClip?.hasSubtitle) {
      this.videoStateService.setLastActiveSubtitleClipId(currentClip.id);
    }

    if (this.player.paused() || !currentClip) {
      return;
    }

    this.schedulePauseIfNeeded(currentClip, currentTime);
  }

  private handleTogglePlayPause(): void {
    if (!this.player) return;
    const isPaused = this.player.paused();
    const isAutoPaused = this.videoStateService.isAutoPaused();

    this.videoStateService.setAutoPaused(false);

    if (isPaused) {
      if (isAutoPaused) {
        this.justPlayedFromAutoPause = true;
      }

      this.clearScheduledPause();
      const currentClip = this.videoStateService.currentClip();
      if (currentClip) {
        this.schedulePauseIfNeeded(currentClip, this.player.currentTime() || 0);
      }

      this.player.play();
    } else {
      // If the user is manually pausing, any scheduled auto-pause must be cancelled.
      this.clearScheduledPause();
      this.player.pause();
    }
    this.videoStateService.clearPlayPauseRequest();
  }

  private handleRepeat(): void {
    const clipToRepeat = this.videoStateService.lastActiveSubtitleClip();
    if (clipToRepeat) {
      this.jumpToTime(clipToRepeat.startTime, true, true);
    }
    this.videoStateService.clearRepeatRequest();
  }

  private handleSeek(request: { time: number; type: SeekType }): void {
    if (!this.player) return;
    let targetTime: number;
    if (request.type === SeekType.Relative) {
      targetTime = (this.player.currentTime() || 0) + request.time;
    } else {
      targetTime = request.time;
    }

    const shouldPlay = !this.player.paused();
    this.jumpToTime(targetTime, shouldPlay);
    this.videoStateService.clearSeekRequest();
  }

  private handleForceContinue(): void {
    if (!this.player) return;
    this.jumpToTime(this.player.currentTime() || 0, true, true);
    this.videoStateService.clearForceContinueRequest();
  }

  private jumpToTime(time: number, shouldPlay: boolean, forcePlay = false): void {
    if (!this.player) return;

    this.clearScheduledPause();
    this.videoStateService.setAutoPaused(false);

    this.player.currentTime(time);
    this.videoStateService.setCurrentTime(time);
    this.videoStateService.recalculateActiveClip();

    const targetClip = this.videoStateService.currentClip();
    const autoPauseAtStart = this.videoStateService.autoPauseAtStart();

    const isAtStartOfSubtitleClip = targetClip?.hasSubtitle && Math.abs(time - targetClip.startTime) < 0.01;

    if (forcePlay) {
      this.justPlayedFromAutoPause = true;
      if (this.player.paused()) {
        this.player.play();
      }
      return;
    }

    if (autoPauseAtStart && isAtStartOfSubtitleClip) {
      if (!this.player.paused()) {
        this.player.pause();
      }
      this.videoStateService.setAutoPaused(true);
    } else if (shouldPlay) {
      this.justPlayedFromAutoPause = true;
      if (this.player.paused()) {
        this.player.play();
      }
    }
  }

  private clearScheduledPause(): void {
    clearTimeout(this.scheduledPauseTimeout);
    this.lastScheduledPauseClipId = null;
  }

  private schedulePauseIfNeeded(clip: VideoClip, currentTime: number): void {
    const autoPauseStart = this.videoStateService.autoPauseAtStart();
    const autoPauseEnd = this.videoStateService.autoPauseAtEnd();

    const isEndTarget = autoPauseEnd && clip.hasSubtitle;
    const isStartTarget = autoPauseStart && !clip.hasSubtitle;

    const shouldPause = isEndTarget || isStartTarget;

    if (!shouldPause) {
      this.clearScheduledPause();
      return;
    }

    if (this.lastScheduledPauseClipId === clip.id) return;

    const timeRemainingMs = (clip.endTime - currentTime) * 1000;

    if (timeRemainingMs > 5) {
      this.lastScheduledPauseClipId = clip.id;
      this.scheduledPauseTimeout = setTimeout(() => {
        if (!this.player || this.player.paused() || this.isSeeking) return;

        this.player.pause();
        this.player.currentTime(clip.endTime);
        this.videoStateService.setAutoPaused(true);

        if (isStartTarget) {
          const nextClip = this.findNextClip(clip.id);
          if (nextClip?.hasSubtitle) {
            this.videoStateService.setLastActiveSubtitleClipId(nextClip.id);
          }
        }
      }, timeRemainingMs);
    }
  }

  private findNextClip(clipId: string): VideoClip | undefined {
    const clips = this.videoStateService.clips();
    const index = clips.findIndex(c => c.id === clipId);
    if (index > -1 && index < clips.length - 1) {
      return clips[index + 1];
    }
    return undefined;
  }
}
