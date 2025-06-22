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
  public readonly progressBarClicked = output<number>();
  private readonly videoElementRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly videoStateService = inject(VideoStateService);
  private player: Player | undefined;
  private progressBarEl: HTMLElement | undefined;
  private isDraggingMouseOnProgressBar = false;
  private animationFrameId: number | undefined;
  private segmentEndTime = 0;

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;
    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.on('loadedmetadata', this.handleLoadedMetadata);
      this.player?.on('timeupdate', this.handleTimeUpdate);
      this.addProgressBarEventListener();
    });
  }

  ngOnDestroy() {
    this.cancelAnimationFrame();
    if (this.player) {
      this.player.off('loadedmetadata', this.handleLoadedMetadata);
      this.player.off('timeupdate', this.handleTimeUpdate);
      this.removeProgressBarEventListeners();
      this.player.dispose();
    }
  }

  private addProgressBarEventListener() {
    this.progressBarEl = this.player?.el()?.querySelector('.vjs-progress-control') as HTMLElement;
    if (this.progressBarEl) {
      this.progressBarEl.addEventListener('mousedown', this.handleMouseDown, {capture: true});
    }
  }

  private removeProgressBarEventListeners() {
    if (this.progressBarEl) {
      this.progressBarEl.removeEventListener('mousedown', this.handleMouseDown, {capture: true});
    }
    // Clean up window listeners in case the component is destroyed mid-drag
    this.removeWindowListeners();
  }

  private addWindowListeners() {
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp, {capture: true});
  }

  private removeWindowListeners() {
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp, {capture: true});
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

  private handleMouseDown = (event: MouseEvent) => {
    this.isDraggingMouseOnProgressBar = true;
    this.addWindowListeners();
    this.calculateAndEmitTime(event);
  };

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.isDraggingMouseOnProgressBar) return;
    this.calculateAndEmitTime(event);
  };

  private handleMouseUp = (event: MouseEvent) => {
    if (!this.isDraggingMouseOnProgressBar) return;
    this.isDraggingMouseOnProgressBar = false;
    this.removeWindowListeners();
    this.calculateAndEmitTime(event);
  };

  private calculateAndEmitTime = (event: MouseEvent) => {
    const holder = this.progressBarEl?.querySelector('.vjs-progress-holder') as HTMLElement;
    if (!this.player || !holder) return;

    const progressBarRect = holder.getBoundingClientRect();
    const clickPositionX = event.clientX - progressBarRect.left;
    const clickPercent = clickPositionX / progressBarRect.width;
    const clampedPercent = Math.max(0, Math.min(1, clickPercent));
    const targetTime = clampedPercent * (this.player?.duration() || 0);

    this.progressBarClicked.emit(targetTime);
  };
}
