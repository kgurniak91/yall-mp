import {Component, effect, inject, input, signal, ViewEncapsulation} from '@angular/core';
import {VideoJsOptions} from './video-controller.type';
import {VideoStateService} from '../../../state/video/video-state.service';
import {SettingsStateService} from '../../../state/settings/settings-state.service';
import {VideoPlayerAction, VideoPlayerCommand} from '../../../model/video.types';
import {ClipPlayerService} from '../services/clip-player/clip-player.service';
import type Player from 'video.js/dist/types/player';
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
  private conductor = inject(ClipPlayerService);

  protected onClipEnded(): void {
    this.conductor.onClipFinished();
  }

  public onNativePlay(): void {
    if (!this.conductor.isPlaying()) {
      this.conductor.playCurrent();
    }
  }

  public onNativePause(): void {
    if (this.conductor.isPlaying()) {
      this.conductor.pause();
    }
  }

  private conductorCommands = effect(() => {
    const clipToPlay = this.conductor.currentClip();
    const isPlaying = this.conductor.isPlaying();
    const shouldSeek = this.conductor.seekToStart();

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
    if (this.conductor.isPlaying()) {
      this.conductor.pause();
    } else {
      this.conductor.resume();
    }
    this.videoStateService.clearPlayPauseRequest();
  }

  private handleRepeat(): void {
    this.conductor.playCurrent();
    this.videoStateService.clearRepeatRequest();
  }
}
