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
import {SeekType} from '../../../model/video.types';

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
  private hasForceContinued = false;
  private scheduledPauseTimeout: any;
  private scheduledPauseForClipId: string | null = null;

  private seekRequestHandler = effect(() => {
    const request = this.videoStateService.seekRequest();
    if (!request || !this.player) return;

    
    let targetTime: number;
    if (request.type === SeekType.Relative) {
      targetTime = (this.player.currentTime() || 0) + request.time;
    } else { // 'absolute'
      targetTime = request.time;
    }



    this.jumpToTime(targetTime);


    this.videoStateService.clearSeekRequest();
  });

  private playPauseRequestHandler = effect(() => {
    const request = this.videoStateService.playPauseRequest();
    if (!request) return;
    this.togglePlay();
  });

  private repeatRequestHandler = effect(() => {
    const request = this.videoStateService.repeatRequest();
    if (!request) return;

    const clipToRepeat = this.videoStateService.lastActiveSubtitleClip();
    if (clipToRepeat) {
      console.log('Repeating clip:', clipToRepeat.text);
      this.jumpToTime(clipToRepeat.startTime);
    }

    this.videoStateService.clearRepeatRequest();
  });

  private forceContinueHandler = effect(() => {
    const request = this.videoStateService.forceContinueRequest();
    if (!request || !this.player) return;

    this.cancelScheduledPause();
    // Flag to bypass autopause logic for one cycle
    this.hasForceContinued = true;
    this.player.play();
  });

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;

    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.pause();

      this.player?.on('timeupdate', () => this.updateTime());

      this.player?.on('loadedmetadata', () => {
        const duration = this.player?.duration() || 0;
        this.videoStateService.setDuration(duration);
      });
    });
  }

  ngOnDestroy() {
    this.cancelScheduledPause();
    if (this.player) {
      this.player.dispose();
    }
    this.videoStateService.setVideoElement(null);
  }

  public jumpToTime(time: number): void {
    if (!this.player) {
      return;
    }

    this.cancelScheduledPause();
    this.hasForceContinued = false;
    this.player.currentTime(time);
    this.player.play();
    this.updateTime();
  }

  public togglePlay(): void {
    if (!this.player) return;
    this.cancelScheduledPause();

    if (this.player.paused()) {
      this.hasForceContinued = true;
      this.player.play();
    } else {
      this.hasForceContinued = false;
      this.player.pause();
    }
  }

  private cancelScheduledPause(): void {
    if (this.scheduledPauseTimeout) {
      clearTimeout(this.scheduledPauseTimeout);
      this.scheduledPauseTimeout = null;
      this.scheduledPauseForClipId = null;
    }
  }

  private updateTime = (): void => {
    if (!this.player || this.player.paused()) {
      this.cancelScheduledPause();
      return;
    }

    const currentTime = this.player.currentTime() || 0;
    this.videoStateService.setCurrentTime(currentTime);

    const currentClip = this.videoStateService.currentClip();
    if (!currentClip) return;

    // Update lastActiveSubtitleClip state
    if (currentClip.hasSubtitle && this.videoStateService.lastActiveSubtitleClip()?.id !== currentClip.id) {
      this.videoStateService.setLastActiveSubtitleClipId(currentClip.id);
    }

    const autoPauseAtStart = this.videoStateService.autoPauseAtStart();
    const autoPauseAtEnd = this.videoStateService.autoPauseAtEnd();

    // Return if no autopause settings are enabled
    if (!autoPauseAtStart && !autoPauseAtEnd) {
      return;
    }

    

    // Determine if current clip is a pause target
    const isEndTarget = autoPauseAtEnd && currentClip.hasSubtitle;
    const isStartTarget = autoPauseAtStart && !currentClip.hasSubtitle;
    const isPauseCandidate = isEndTarget || isStartTarget;

    // Reset force continue flag for pause candidates
    
    if (isPauseCandidate) {
      this.hasForceContinued = false;
    }

    // Return if in force continue state
    if (this.hasForceContinued) {
      return;
    }

    // If a pause is already scheduled for this clip, do nothing.
    if (this.scheduledPauseForClipId === currentClip.id) {
      return;
    }

    // If the current clip is a candidate, schedule the pause.
    if (isPauseCandidate) {
      const pauseTargetTime = currentClip.endTime;
      const timeRemainingMs = (pauseTargetTime - currentTime) * 1000;

      if (timeRemainingMs > 5) { // Use a small threshold to avoid scheduling tiny timeouts
        this.cancelScheduledPause(); // Clear any old timers
        this.scheduledPauseForClipId = currentClip.id;

        this.scheduledPauseTimeout = setTimeout(() => {
          if (!this.player || this.player.paused() || this.hasForceContinued) return;

          console.log(`Executing scheduled pause for clip ${currentClip.id}`);
          this.player.pause();
          this.player.currentTime(pauseTargetTime);
        }, timeRemainingMs);
      }
    } else {
      // This clip is not a pause candidate
      // so ensure no old pause is pending.
      this.cancelScheduledPause();
    }
  }
}
