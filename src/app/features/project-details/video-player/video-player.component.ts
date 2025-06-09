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
  videoPlayerElementRef = viewChild.required<ElementRef<HTMLVideoElement>>('videoPlayer');
  options = input.required<VideoJsOptions>();
  private player: Player | undefined;
  private videoStateService = inject(VideoStateService);

  ngOnInit() {
    this.player = videojs(this.videoPlayerElementRef().nativeElement, this.options(), () => {
      this.player?.pause();

      this.player?.on('timeupdate', () => {
        const currentTime = this.player?.currentTime() || 0;
        this.videoStateService.updateCurrentTime(currentTime);
      })
    });
  }

  ngOnDestroy() {
    if (this.player) {
      this.player.dispose();
    }
  }

  jumpToPercentage(percentage: number): void {
    if (!this.player) {
      return;
    }

    const duration = this.player.duration() || 0;
    const newTime = (percentage / 100) * duration;

    this.player.currentTime(newTime);
    this.player.play();
  }

  jumpToTime(time: number): void {
    if (!this.player) {
      return;
    }

    this.player.currentTime(time);
    this.player.play();
  }
}
