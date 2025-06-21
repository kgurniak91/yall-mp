import {Component, effect, ElementRef, inject, input, OnDestroy, OnInit, output, viewChild} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoJsOptions} from '../video-controller/video-controller.type';
import {PauseCommand, PlayCommand, VideoPlayerAction, VideoPlayerCommand} from '../../../model/video.types';
import Player from 'video.js/dist/types/player';
import videojs from 'video.js';

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss'
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  public readonly options = input.required<VideoJsOptions>();
  public readonly command = input<VideoPlayerCommand | null>();
  public readonly clipEnded = output<void>();
  private readonly videoElementRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly videoStateService = inject(VideoStateService);
  private player: Player | undefined;
  private animationFrameId: number | undefined;
  private segmentEndTime = 0;

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;
    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.on('loadedmetadata', this.handleLoadedMetadata);
      this.player?.on('timeupdate', this.handleTimeUpdate);
    });
  }

  ngOnDestroy() {
    this.cancelAnimationFrame();
    if (this.player) {
      this.player.off('loadedmetadata', this.handleLoadedMetadata);
      this.player.off('timeupdate', this.handleTimeUpdate);
      this.player.dispose();
    }
  }

  private videoControllerCommands = effect(() => {
    const command = this.command();
    if (!command) return;

    if (command.action === VideoPlayerAction.Play) {
      this.playSegment(command);
    } else if (command.action === VideoPlayerAction.Pause) {
      this.pause(command);
    }
  });

  private playSegment(command: PlayCommand): void {
    if (!this.player) {
      return;
    }

    this.segmentEndTime = command.clip.endTime;
    this.player.playbackRate(command.playbackRate);

    if (command.seekToTime != null) {
      this.player.currentTime(command.seekToTime);
    }

    this.cancelAnimationFrame();

    this.player.play();
    this.checkTime();
  }

  private pause(command: PauseCommand): void {
    if (!this.player) {
      return;
    }

    this.cancelAnimationFrame();

    if (command.seekToTime != null) {
      this.player.currentTime(command.seekToTime);
    }

    this.player?.pause();
  }

  private checkTime = () => {
    if (!this.player) {
      return;
    }

    const currentTime = this.player.currentTime() || 0;
    if (currentTime >= (this.segmentEndTime - 0.01)) {
      this.cancelAnimationFrame();
      this.player.currentTime(this.segmentEndTime);
      this.clipEnded.emit();
    } else {
      this.animationFrameId = requestAnimationFrame(this.checkTime);
    }
  };

  private handleTimeUpdate = () => {
    if (this.player) {
      this.videoStateService.setCurrentTime(this.player.currentTime() || 0);
    }
  };

  private handleLoadedMetadata = () => {
    if (this.player) {
      this.videoStateService.setDuration(this.player.duration() || 0);
    }
  };

  private cancelAnimationFrame(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }
}
