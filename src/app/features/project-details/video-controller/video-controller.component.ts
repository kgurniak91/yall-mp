import {Component, effect, inject, OnDestroy, output, ViewEncapsulation} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {PlayerState, SeekType, VideoClip} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {VideoPlayerComponent} from '../video-player/video-player.component';
import {ProjectSettingsStateService} from '../../../state/project-settings/project-settings-state.service';
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
export class VideoControllerComponent implements OnDestroy {
  public readonly ready = output<void>();
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly PlayerState = PlayerState;
  private readonly videoStateService = inject(VideoStateService);
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);

  ngOnDestroy() {
    window.electronAPI.mpvCommand(['stop']);
  }

  protected onVideoAreaClicked(): void {
    this.handleTogglePlayPause();
  }

  private clipProgressionHandler = effect(() => {
    const currentTime = this.videoStateService.currentTime();
    const currentClip = this.clipsStateService.currentClip();
    const isPlaying = this.clipsStateService.isPlaying();

    if (!currentClip || !isPlaying || currentTime === 0) {
      return;
    }

    if (currentTime >= currentClip.endTime) {
      this.handleClipEnd(currentClip);
    }
  });

  private handleClipEnd(clipJustFinished: VideoClip) {
    const autoPauseAtEnd = this.projectSettingsStateService.autoPauseAtEnd();

    if (clipJustFinished.hasSubtitle && autoPauseAtEnd) {
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtEnd);
      window.electronAPI.mpvSetProperty('pause', true);
      return;
    }

    const isLastClip = this.clipsStateService.currentClipIndex() === this.clipsStateService.clips().length - 1;
    if (isLastClip) {
      this.clipsStateService.setPlayerState(PlayerState.Idle);
      return;
    }

    this.clipsStateService.advanceToNextClip();
    const nextClip = this.clipsStateService.currentClip()!;
    this.playClip(nextClip, {seekToTime: nextClip.startTime});
  }

  private mpvSubtitleSync = effect(() => {
    const subtitlesVisible = this.videoStateService.subtitlesVisible();
    window.electronAPI.mpvSetProperty('sub-visibility', subtitlesVisible);
  });

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
    console.log('[Renderer] VideoStateService: Sending "cycle pause" command.');
    window.electronAPI.mpvCommand(['cycle', 'pause']);
    this.videoStateService.clearPlayPauseRequest();
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
      this.playClip(currentClip);
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
    
    const wasPlaying = this.clipsStateService.isPlaying();
    const originClipIndex = this.clipsStateService.currentClipIndex();

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
    const autoPauseAtStart = this.projectSettingsStateService.autoPauseAtStart();
    const isLandingAtStartOfSubtitledClip = newClip.hasSubtitle && Math.abs(targetTime - newClip.startTime) < 0.1;
    const isJumpingToNewClip = originClipIndex !== targetClipIndex;

    if (autoPauseAtStart && isLandingAtStartOfSubtitledClip && isJumpingToNewClip) {
      
      this.clipsStateService.setPlayerState(PlayerState.AutoPausedAtStart);
      window.electronAPI.mpvCommand(['seek', newClip.startTime, 'absolute']);
      window.electronAPI.mpvSetProperty('pause', true);
    } else {
      if (wasPlaying) {
        // If playing, continue playing from the new position.
        this.playClip(newClip, {seekToTime: targetTime});
      } else {
        
        
        this.clipsStateService.setPlayerState(PlayerState.PausedByUser);
        window.electronAPI.mpvCommand(['seek', targetTime, 'absolute']);
        window.electronAPI.mpvSetProperty('pause', true);
      }
    }

    this.videoStateService.clearSeekRequest();
  }

  private playClip(clip: VideoClip, options?: { seekToTime?: number }): void {
    this.clipsStateService.setPlayerState(PlayerState.Playing);

    const subtitledSpeed = this.projectSettingsStateService.subtitledClipSpeed();
    const gapSpeed = this.projectSettingsStateService.gapSpeed();
    const playbackRate = clip.hasSubtitle ? subtitledSpeed : gapSpeed;

    window.electronAPI.mpvSetProperty('speed', playbackRate);

    if (options?.seekToTime != null) {
      window.electronAPI.mpvCommand(['seek', options.seekToTime, 'absolute']);
    }

    window.electronAPI.mpvSetProperty('pause', false);
  }
}
