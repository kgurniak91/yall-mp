import {Component, effect, inject, input, signal, ViewEncapsulation} from '@angular/core';
import {VideoJsOptions} from './video-controller.type';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoPlayerAction, VideoPlayerCommand} from '../../../model/video.types';
import {ClipPlayerService} from '../services/clip-player/clip-player.service';
import {VideoPlayerComponent} from '../video-player/video-player.component';

@Component({
  selector: 'app-video-controller',
  imports: [
    VideoPlayerComponent
  ],
  templateUrl: './video-controller.component.html',
  styleUrl: './video-controller.component.scss',
  encapsulation: ViewEncapsulation.None
})
export class VideoControllerComponent {
  options = input.required<VideoJsOptions>();
  protected command = signal<VideoPlayerCommand | null>(null);
  private videoStateService = inject(VideoStateService);
  private clipPlayerService = inject(ClipPlayerService);

  protected onClipEnded(): void {
    this.clipPlayerService.onClipFinished();
  }

  protected onNativePlay(): void {
    if (!this.clipPlayerService.isPlaying()) {
      this.clipPlayerService.playCurrent();
    }
  }

  protected onNativePause(): void {
    if (this.clipPlayerService.isPlaying()) {
      this.clipPlayerService.pause();
    }
  }

  private conductorCommands = effect(() => {
    const clipToPlay = this.clipPlayerService.currentClip();
    const isPlaying = this.clipPlayerService.isPlaying();
    const shouldSeek = this.clipPlayerService.seekToStart();

    if (isPlaying && clipToPlay) {
      this.command.set({clip: clipToPlay, action: VideoPlayerAction.Play, seekToStart: shouldSeek});
    } else if (clipToPlay) {
      this.command.set({clip: clipToPlay, action: VideoPlayerAction.Pause});
    }
  });

  private requestHandler = effect(() => {
    const playPauseRequest = this.videoStateService.playPauseRequest();
    if (playPauseRequest) this.handleTogglePlayPause();

    const repeatRequest = this.videoStateService.repeatRequest();
    if (repeatRequest) this.handleRepeat();
  });

  private handleTogglePlayPause(): void {
    if (this.clipPlayerService.isPlaying()) {
      this.clipPlayerService.pause();
    } else {
      this.clipPlayerService.resume();
    }
    this.videoStateService.clearPlayPauseRequest();
  }

  private handleRepeat(): void {
    this.clipPlayerService.playCurrent();
    this.videoStateService.clearRepeatRequest();
  }
}
