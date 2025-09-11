import {Component, computed, effect, inject, OnDestroy, output, viewChild, ViewEncapsulation} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {PlayerState, SeekType, VideoClip} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {VideoPlayerComponent} from '../video-player/video-player.component';
import {ProjectSettingsStateService} from '../../../state/project-settings/project-settings-state.service';
import {SubtitleBehavior} from '../../../model/settings.types';
import {MpvClipRequest} from '../../../../electron-api';

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
  protected readonly PlayerState = PlayerState;
  private readonly videoStateService = inject(VideoStateService);
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly videoPlayer = viewChild.required(VideoPlayerComponent);

  ngOnDestroy() {
    window.electronAPI.mpvCommand(['stop']);
  }

  protected onVideoAreaClicked(): void {
    this.handleTogglePlayPause();
  }

  // This handler fires when MPV becomes paused for any reason.
  private autoAdvanceHandler = effect(() => {
    const isPaused = this.videoStateService.isPaused();
    const playerState = this.clipsStateService.playerState();
    const currentClip = this.clipsStateService.currentClip();

    if (!isPaused || playerState !== PlayerState.Playing || !currentClip) {
      return;
    }

    // Check if the pause happened at (or very near) the end of current clip.
    const currentTime = this.videoStateService.currentTime();
    if (Math.abs(currentTime - currentClip.endTime) < 0.1) {
      this.handleClipEnd(currentClip);
    }
  });

  private handleClipEnd(clipJustFinished: VideoClip) {
    const autoPauseAtEnd = this.projectSettingsStateService.autoPauseAtEnd();

    if (clipJustFinished.hasSubtitle && autoPauseAtEnd) {
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtEnd);
      this.videoStateService.setCurrentTime(clipJustFinished.endTime);
      return;
    }

    const isLastClip = this.clipsStateService.currentClipIndex() === this.clipsStateService.clips().length - 1;
    if (isLastClip) {
      this.clipsStateService.setPlayerState(PlayerState.Idle);
      return;
    }

    this.clipsStateService.advanceToNextClip();
    const nextClip = this.clipsStateService.currentClip()!;
    const autoPauseAtStart = this.projectSettingsStateService.autoPauseAtStart();

    // Check if the auto-pause at the start of the NEW clip is needed
    if (nextClip.hasSubtitle && autoPauseAtStart) {
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtStart);
      window.electronAPI.mpvCommand(['seek', nextClip.startTime, 'absolute']);
      window.electronAPI.mpvSetProperty('pause', true);
      this.videoStateService.setCurrentTime(nextClip.startTime);
    } else {
      // Otherwise, play the next clip normally
      this.playClip(nextClip);
    }
  }

  private subtitleBehaviorEnforcer = effect(() => {
    const currentClip = this.clipsStateService.currentClip();
    const behavior = this.projectSettingsStateService.subtitleBehavior();

    if (currentClip?.hasSubtitle) {
      if (behavior === SubtitleBehavior.ForceShow) {
        this.videoStateService.setSubtitlesVisible(true);
      } else if (behavior === SubtitleBehavior.ForceHide) {
        this.videoStateService.setSubtitlesVisible(false);
      }
    }
  });

  private requestHandler = effect(() => {
    if (this.videoStateService.playPauseRequest()) {
      this.handleTogglePlayPause();
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
    const state = this.clipsStateService.playerState();

    if (state === PlayerState.Playing) {
      console.log('[VideoController] handleTogglePlayPause -> pause');
      window.electronAPI.mpvSetProperty('pause', true);
      this.clipsStateService.setPlayerState(PlayerState.PausedByUser);
      this.videoStateService.saveCurrentPlaybackTime();
    } else {
      console.log('[VideoController] handleTogglePlayPause -> resume');
      this.handleResume();
    }

    this.videoStateService.clearPlayPauseRequest();
  }

  private handleResume(): void {
    const playerState = this.clipsStateService.playerState();
    const currentClip = this.clipsStateService.currentClip()!;

    if (playerState === PlayerState.AutoPausedAtEnd) {
      // Resume advances to and plays the next clip.
      this.clipsStateService.advanceToNextClip();
      const nextClip = this.clipsStateService.currentClip()!;
      const autoPauseAtStart = this.projectSettingsStateService.autoPauseAtStart();

      if (nextClip.hasSubtitle && autoPauseAtStart) {
        this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtStart);
        window.electronAPI.mpvCommand(['seek', nextClip.startTime, 'absolute']);
        window.electronAPI.mpvSetProperty('pause', true);
      } else {
        this.playClip(nextClip);
      }
    } else {
      // In these cases, "resume" means play the CURRENT clip from its beginning or current position.
      const resumeTime = this.videoStateService.currentTime();
      this.playClip(currentClip, {seekToTime: resumeTime});
    }
  }

  private handleForceContinue(): void {
    if (!this.clipsStateService.isPlaying()) {
      this.handleResume();
    }
    this.videoStateService.clearForceContinueRequest();
  }

  private handleRepeat(): void {
    const currentClip = this.clipsStateService.currentClip();
    if (currentClip) {
      this.playClip(currentClip, {seekToTime: currentClip.startTime});
    }
    this.videoStateService.clearRepeatRequest();
  }

  private handleSeek(request: { time: number; type: SeekType }): void {
    const playerState = this.clipsStateService.playerState();
    if (playerState === PlayerState.AutoPausedAtEnd || playerState === PlayerState.AutoPausedAtStart) {
      this.clipsStateService.setPlayerState(PlayerState.PausedByUser);
    }

    const wasPlaying = this.clipsStateService.isPlaying();

    let targetTime: number;
    if (request.type === SeekType.Relative) {
      const currentTime = this.videoStateService.currentTime();
      targetTime = currentTime + request.time;
    } else { // Absolute
      targetTime = request.time;
    }
    const duration = this.videoStateService.duration();
    targetTime = Math.max(0, Math.min(targetTime, duration - 0.01));

    // Optimistic UI update before MPV call
    this.videoStateService.setCurrentTime(targetTime);

    const clips = this.clipsStateService.clips();
    const targetClipIndex = clips.findIndex(c => targetTime >= c.startTime && targetTime < c.endTime);
    if (targetClipIndex === -1) {
      this.videoStateService.clearSeekRequest();
      return;
    }
    this.clipsStateService.setCurrentClipByIndex(targetClipIndex);
    const newClip = this.clipsStateService.currentClip()!;

    if (wasPlaying) {
      // If video was playing, continue playing, but with the rules of the NEW clip.
      this.playClip(newClip, {seekToTime: targetTime});
    } else {
      // If video was paused, tell MPV to go to the new time and remain paused.
      window.electronAPI.mpvSeekAndPause(targetTime);
    }

    this.videoStateService.clearSeekRequest();
  }

  private playClip(clip: VideoClip, options?: { seekToTime?: number }): void {
    this.clipsStateService.setPlayerState(PlayerState.Playing);

    const subtitledSpeed = this.projectSettingsStateService.subtitledClipSpeed();
    const gapSpeed = this.projectSettingsStateService.gapSpeed();
    const playbackRate = clip.hasSubtitle ? subtitledSpeed : gapSpeed;

    const request: MpvClipRequest = {
      startTime: options?.seekToTime ?? clip.startTime,
      endTime: clip.endTime,
      playbackRate: playbackRate,
    };

    window.electronAPI.mpvPlayClip(request);
  }
}
