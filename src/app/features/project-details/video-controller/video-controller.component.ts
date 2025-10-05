import {Component, computed, effect, inject, OnDestroy, output, viewChild, ViewEncapsulation} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {SeekType} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
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
export class VideoControllerComponent implements OnDestroy {
  public readonly ready = output<void>();
  public readonly videoContainerElement = computed(() => this.videoPlayer().mpvPlaceholderRef()?.nativeElement);
  protected readonly clipsStateService = inject(ClipsStateService);
  private readonly videoStateService = inject(VideoStateService);
  private readonly videoPlayer = viewChild.required(VideoPlayerComponent);

  ngOnDestroy() {
    window.electronAPI.mpvCommand(['stop']);
  }

  private requestHandler = effect(() => {
    if (this.videoStateService.playPauseRequest()) {
      this.handleTogglePlayPause();
    }

    if (this.videoStateService.toggleSubtitlesRequest()) {
      this.handleToggleSubtitles();
    }

    if (this.videoStateService.repeatRequest()) {
      this.handleRepeat();
    }

    if (this.videoStateService.forceContinueRequest()) {
      this.handleForceContinue();
    }

    const seekRequest = this.videoStateService.seekRequest();
    if (seekRequest) {
      this.handleSeek(seekRequest);
    }
  });

  private handleTogglePlayPause(): void {
    window.electronAPI.playbackTogglePlayPause();
    this.videoStateService.clearPlayPauseRequest();
  }

  private handleToggleSubtitles(): void {
    window.electronAPI.playbackToggleSubtitles();
    this.videoStateService.clearToggleSubtitlesRequest();
  }

  private handleForceContinue(): void {
    window.electronAPI.playbackForceContinue();
    this.videoStateService.clearForceContinueRequest();
  }

  private handleRepeat(): void {
    window.electronAPI.playbackRepeat();
    this.videoStateService.clearRepeatRequest();
  }

  private handleSeek(request: { time: number; type: SeekType }): void {
    let targetTime: number;
    if (request.type === SeekType.Relative) {
      const currentTime = this.videoStateService.currentTime();
      targetTime = currentTime + request.time;
    } else { // Absolute
      targetTime = request.time;
    }
    const duration = this.videoStateService.duration();
    targetTime = Math.max(0, Math.min(targetTime, duration - 0.01));

    // Optimistic UI update
    this.videoStateService.setCurrentTime(targetTime);

    window.electronAPI.playbackSeek(targetTime);
    this.videoStateService.clearSeekRequest();
  }
}
