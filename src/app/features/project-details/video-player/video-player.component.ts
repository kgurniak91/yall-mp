import {Component, effect, ElementRef, inject, input, OnDestroy, OnInit, output, viewChild} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoJsOptions} from '../video-controller/video-controller.type';
import {VideoPlayerAction, VideoPlayerCommand} from '../../../model/video.types';
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
  protected readonly videoElementRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private player: Player | undefined;
  private animationFrameId: number | undefined;
  private segmentEndTime = 0;
  private videoStateService = inject(VideoStateService);

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;
    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.on('loadedmetadata', this.handleLoadedMetadata);
      this.player?.on('timeupdate', this.handleTimeUpdate);
    });
  }

  ngOnDestroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.player) {
      this.player.off('loadedmetadata', this.handleLoadedMetadata);
      this.player.off('timeupdate', this.handleTimeUpdate);
      this.player.dispose();
    }
  }

  private videoControllerCommands = effect(() => {
    const cmd = this.command();
    if (!cmd) return;

    if (cmd.action === VideoPlayerAction.Play) {
      this.playSegment(cmd.clip.startTime, cmd.clip.endTime);
    } else {
      this.pause();
    }
  });

  private playSegment(startTime: number, endTime: number): void {
    if (!this.player) return;

    this.segmentEndTime = endTime;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.player.currentTime(startTime);
    this.player.play();
    this.checkTime();
  }

  private pause(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.player?.pause();
  }

  private checkTime = () => {
    if (!this.player || this.player.paused()) {
      return; 
    }

    let currentTime = this.player.currentTime() || 0;
    if (currentTime >= this.segmentEndTime) {
      this.player.pause();
      this.player.currentTime(this.segmentEndTime);
      cancelAnimationFrame(this.animationFrameId!);
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
}
