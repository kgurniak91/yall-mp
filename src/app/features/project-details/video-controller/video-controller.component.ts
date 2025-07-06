import {Component, effect, inject, input, signal, ViewEncapsulation} from '@angular/core';
import {VideoJsOptions} from './video-controller.type';
import {VideoStateService} from '../../../state/video/video-state.service';
import {
  PlayCommand,
  PlayerState,
  SeekType,
  VideoClip,
  VideoPlayerAction,
  VideoPlayerCommand
} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {VideoPlayerComponent} from '../video-player/video-player.component';
import {SettingsStateService} from '../../../state/settings/settings-state.service';
import {SubtitleBehavior} from '../../../model/settings.types';

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
  public readonly options = input.required<VideoJsOptions>();
  protected readonly command = signal<VideoPlayerCommand | null>(null);
  protected readonly PlayerState = PlayerState;
  protected readonly clipsStateService = inject(ClipsStateService);
  private readonly videoStateService = inject(VideoStateService);
  private readonly settingsStateService = inject(SettingsStateService);

  // Called when a clip finishes
  protected onClipEnded(): void {
    const clipJustFinished = this.clipsStateService.currentClip()!;
    const autoPauseAtEnd = this.settingsStateService.autoPauseAtEnd();

    if (clipJustFinished.hasSubtitle && autoPauseAtEnd) {
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtEnd);
      this.command.set({action: VideoPlayerAction.Pause, clip: clipJustFinished});
      return;
    }

    const isLastClip = this.clipsStateService.currentClipIndex() === this.clipsStateService.clips().length - 1;
    if (isLastClip) {
      // Reached the end of the video.
      this.clipsStateService.setPlayerState(PlayerState.Idle);
      return;
    }

    // Continue to the next clip.
    this.clipsStateService.advanceToNextClip();
    const nextClip = this.clipsStateService.currentClip();

    if (!nextClip) {
      this.clipsStateService.setPlayerState(PlayerState.Idle);
      return;
    }

    // If the next clip is a gap, always play it.
    if (!nextClip.hasSubtitle) {
      this.playClip(nextClip, {seekToTime: nextClip.startTime});
      return;
    }

    // The next clip is a subtitle clip. Check if it requires pausing at the start.
    const autoPauseAtStart = this.settingsStateService.autoPauseAtStart();
    if (autoPauseAtStart) {
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtStart);
      // Issue a pause command to ensure the player's time is synced to the start of the new clip.
      this.command.set({action: VideoPlayerAction.Pause, clip: nextClip});
    } else {
      // No auto-pause, so just play the subtitle clip.
      this.playClip(nextClip, {seekToTime: nextClip.startTime});
    }
  }

  protected onProgressBarClicked(targetTime: number): void {
    this.handleSeek({time: targetTime, type: SeekType.Absolute});
  }

  protected onVideoAreaClicked(): void {
    this.handleTogglePlayPause();
  }

  private subtitleVisibilityHandler = effect(() => {
    const currentClip = this.clipsStateService.currentClip();
    const behavior = this.settingsStateService.subtitleBehavior();

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
    if (this.clipsStateService.isPlaying()) {
      this.handlePause();
    } else {
      this.handleResume();
    }
    this.videoStateService.clearPlayPauseRequest();
  }

  private handlePause(): void {
    this.clipsStateService.setPlayerState(PlayerState.PausedByUser);
    this.command.set({action: VideoPlayerAction.Pause, clip: this.clipsStateService.currentClip()!});
  }

  private handleResume(): void {
    const playerState = this.clipsStateService.playerState();
    const currentClip = this.clipsStateService.currentClip()!;

    if (playerState === PlayerState.AutoPausedAtEnd) {
      // Resume advances to and plays the next clip.
      this.clipsStateService.advanceToNextClip();
      const nextClip = this.clipsStateService.currentClip()!;
      this.playClip(nextClip, {seekToTime: nextClip.startTime});
    } else {
      // Resume plays the current clip.
      const seekToTime = (playerState !== PlayerState.PausedByUser) ? currentClip.startTime : undefined;
      this.playClip(currentClip, {seekToTime});
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
    // Calculate target time from the state service.
    let targetTime: number;
    if (request.type === SeekType.Relative) {
      const currentTime = this.videoStateService.currentTime();
      const seekAmount = request.time;
      if (currentTime + seekAmount < 0) {
        targetTime = 0;
      } else {
        targetTime = currentTime + seekAmount;
      }
    } else { // Absolute
      targetTime = request.time;
    }
    const duration = this.videoStateService.duration();
    targetTime = Math.max(0, Math.min(targetTime, duration - 0.01));

    // Find new clip and update the state.
    const clips = this.clipsStateService.clips();
    const targetClipIndex = clips.findIndex(c => targetTime >= c.startTime && targetTime < c.endTime);
    if (targetClipIndex === -1) {
      this.videoStateService.clearSeekRequest();
      return;
    }
    this.clipsStateService.setCurrentClipByIndex(targetClipIndex);
    const newClip = this.clipsStateService.currentClip()!;

    if (this.clipsStateService.isPlaying()) {
      // If playing, continue playing from the new position.
      this.playClip(newClip, {seekToTime: targetTime});
    } else {
      // If paused, remain paused at the new position.
      // A `Pause` command with a `seekToTime` is the correct tool for this.
      this.command.set({action: VideoPlayerAction.Pause, clip: newClip, seekToTime: targetTime});

      // Set the correct PAUSED state for the next resume action.
      const autoPauseAtStart = this.settingsStateService.autoPauseAtStart();
      if (newClip.hasSubtitle && autoPauseAtStart && Math.abs(targetTime - newClip.startTime) < 0.1) {
        this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtStart);
      } else {
        this.clipsStateService.setPlayerState(PlayerState.PausedByUser);
      }
    }

    this.videoStateService.clearSeekRequest();
  }

  private playClip(clip: VideoClip, options?: { seekToTime?: number }): void {
    this.clipsStateService.setPlayerState(PlayerState.Playing);

    const subtitledSpeed = this.settingsStateService.subtitledClipSpeed();
    const gapSpeed = this.settingsStateService.gapSpeed();
    const playbackRate = clip.hasSubtitle ? subtitledSpeed : gapSpeed;

    const command: PlayCommand = {
      action: VideoPlayerAction.Play,
      clip,
      playbackRate,
      seekToTime: options?.seekToTime,
    };
    this.command.set(command);
  }
}
