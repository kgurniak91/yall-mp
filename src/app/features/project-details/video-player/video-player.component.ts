import {Component, ElementRef, inject, input, OnDestroy, OnInit, viewChild, ViewEncapsulation} from '@angular/core';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import {VideoJsOptions} from './video-player.type';
import {VideoStateService} from '../../../state/video-state.service';

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

  ngOnInit() {
    const videoElement = this.videoElementRef().nativeElement;

    this.videoStateService.setVideoElement(videoElement);

    this.player = videojs(videoElement, this.options(), () => {
      this.player?.pause();

      this.player?.on('timeupdate', () => {
        const currentTime = this.player?.currentTime() || 0;
        this.videoStateService.setCurrentTime(currentTime);
      });

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
}
