import {Component, ElementRef, input, OnDestroy, OnInit, viewChild, ViewEncapsulation} from '@angular/core';
import videojs from 'video.js';
import Player from 'video.js/dist/types/player';
import {VideoJsOptions} from './video-player.type';

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

  ngOnInit() {
    this.player = videojs(this.videoPlayerElementRef().nativeElement, this.options(), function onPlayerReady() {
      
      this.pause();
    });
  }

  ngOnDestroy() {
    if (!this.player) {
      return;
    }

    this.player.dispose();
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

  getCurrentTime(): number {
    return this.player?.currentTime() || 0;
  }
}
