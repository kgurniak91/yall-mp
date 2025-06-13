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

  private seekRequestHandler = effect(() => {
    const request = this.videoStateService.seekRequest();
    if (!request || !this.player) return;

    if (request.type === SeekType.Relative) {
      const newTime = (this.player.currentTime() || 0) + request.time;
      this.player.currentTime(newTime);
    } else { // 'absolute'
      this.player.currentTime(request.time);
    }
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
    if (this.player) {
      this.player.dispose();
    }
    this.videoStateService.setVideoElement(null);
  }

  public jumpToTime(time: number): void {
    if (!this.player) {
      return;
    }

    this.hasForceContinued = false;
    this.player.currentTime(time);
    this.player.play();
  }

  public togglePlay(): void {
    if (!this.player) return;

    if (this.player.paused()) {
      this.player.play();
    } else {
      this.player.pause();
    }
  }

  private updateTime = (): void => {
    if (!this.player) return;

    const currentTime = this.player.currentTime() || 0;
    this.videoStateService.setCurrentTime(currentTime);

    const currentClip = this.videoStateService.currentClip();

    // Update the "last active subtitle clip" state
    if (currentClip?.hasSubtitle) {
      if (this.videoStateService.lastActiveSubtitleClip()?.id !== currentClip.id) {
        this.videoStateService.setLastActiveSubtitleClip(currentClip);
      }
    }

    const clipToCheck = this.videoStateService.lastActiveSubtitleClip();
    if (!clipToCheck) {
      // If no subtitle clip encountered yet, return
      return;
    }

    // Handle the "force continue" flag
    if (this.hasForceContinued) {
      // Reset the flag once playback is outside the boundaries of the previous clip
      if (currentTime > clipToCheck.endTime + 0.1 || currentTime < clipToCheck.startTime - 0.1) {
        this.hasForceContinued = false;
      }
      return; // Skip pause logic on this frame
    }

    // Check the autopause condition
    const autoPauseAtEnd = this.videoStateService.autoPauseAtEnd();
    if (autoPauseAtEnd && currentTime >= clipToCheck.endTime && !this.player.paused()) {
      // Ensure not pausing again immediately after forcing a continue
      // The check for !this.hasForceContinued is implicitly handled above

      // Prevent re-pausing if playback has moved on
      // This is important for when the next clip is very short.
      if (currentTime < clipToCheck.endTime + 0.5) { // 0.5s grace window
        console.log('Autopausing at end of clip:', clipToCheck.text);
        this.player.pause();
      }
    }
  }
}
