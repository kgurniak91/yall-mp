import {MpvManager} from './mpv-manager';
import type {VideoClip} from './src/app/model/video.types';
import {PlayerState} from './src/app/model/video.types';
import type {ProjectSettings} from './src/app/model/settings.types';
import {SubtitleBehavior} from './src/app/model/settings.types';
import {BrowserWindow} from 'electron';

export interface PlaybackStateUpdate {
  playerState: PlayerState;
  currentClipIndex: number;
  currentTime: number;
  isPaused: boolean;
  subtitlesVisible: boolean;
}

export class PlaybackManager {
  private clips: VideoClip[] = [];
  private settings: ProjectSettings | null = null;
  private currentClipIndex = -1;
  private playerState: PlayerState = PlayerState.Idle;
  private currentTime = 0;
  private preSeekState: PlayerState = PlayerState.Idle;
  private userOverriddenClipId: string | null = null;
  private subtitlesVisible: boolean = true;
  private isSeekingWithinSameClip = false;
  private mpvSubtitlesHiddenDueToRenderer = false;
  private isProjectLoaded = false;

  constructor(
    private mpvManager: MpvManager,
    private uiWindow: BrowserWindow,
  ) {
    this.mpvManager.on('status', (status) => this.handleMpvEvent(status));
  }

  public get isPaused(): boolean {
    switch (this.playerState) {
      case PlayerState.Playing:
        return false;
      default:
        return true;
    }
  }

  public loadProject(clips: VideoClip[], settings: ProjectSettings, lastPlaybackTime: number): void {
    this.isProjectLoaded = true;
    this.clips = clips;
    this.settings = settings;
    this.subtitlesVisible = settings.subtitlesVisible;

    let initialClipIndex = this.clips.findIndex(
      (c) => lastPlaybackTime >= c.startTime && lastPlaybackTime < c.endTime
    );
    if (initialClipIndex === -1) {
      initialClipIndex = 0;
    }
    this.currentClipIndex = initialClipIndex;
    this.currentTime = lastPlaybackTime;
    this.userOverriddenClipId = null;
    this.mpvSubtitlesHiddenDueToRenderer = false;
    this.setPlayerState(PlayerState.Idle, true);
  }

  public play(): void {
    if (this.playerState === PlayerState.AutoPausedAtEnd) {
      this.playClipAtIndex(this.currentClipIndex + 1);
    } else {
      // If starting from a paused or idle state, re-apply settings to prevent race conditions.
      if (this.isPaused) {
        this.applyClipTransitionSettings();
      }
      this.mpvManager.setProperty('pause', false);
      this.setPlayerState(PlayerState.Playing);
    }
  }

  public pause(): void {
    this.mpvManager.setProperty('pause', true);
    this.setPlayerState(PlayerState.PausedByUser);
  }

  public togglePlayPause(): void {
    if (this.isPaused) {
      this.play();
    } else {
      this.pause();
    }
  }

  public toggleSubtitles(): void {
    const currentClip = this.clips[this.currentClipIndex];
    if (!currentClip) {
      return;
    }

    this.subtitlesVisible = !this.subtitlesVisible;
    this.userOverriddenClipId = currentClip.id;

    if (this.settings?.useMpvSubtitles) {
      if (this.subtitlesVisible) {
        this.mpvManager.showSubtitles();
      } else {
        this.mpvManager.hideSubtitles();
      }
    }

    this.notifyUI();
  }

  public repeat(): void {
    const clip = this.clips[this.currentClipIndex];
    if (clip) {
      this.mpvManager.sendCommand(['seek', clip.startTime, 'absolute']);
      this.mpvManager.setProperty('pause', false);
      this.setPlayerState(PlayerState.Playing);
    }
  }

  public forceContinue(): void {
    if (this.isPaused) {
      this.play();
    }
  }

  public seek(time: number): void {
    const targetClipIndex = this.clips.findIndex(
      (c) => time >= c.startTime && time < c.endTime
    );
    if (targetClipIndex === -1) {
      return;
    }

    const oldClipIndex = this.currentClipIndex;
    this.isSeekingWithinSameClip = (oldClipIndex === targetClipIndex);

    this.currentClipIndex = targetClipIndex;
    this.currentTime = time;

    // Apply speed setting immediately for the new clip to prevent race condition
    const clip = this.clips[this.currentClipIndex];
    if (clip && this.settings) {
      const speed = clip.hasSubtitle ? this.settings.subtitledClipSpeed : this.settings.gapSpeed;
      this.mpvManager.setProperty('speed', speed);
    }

    // Handle anti-flicker hide for subtitles if moving to a new clip
    if (!this.isSeekingWithinSameClip) {
      this.userOverriddenClipId = null;
      if (this.settings?.useMpvSubtitles) {
        this.mpvManager.hideSubtitles();
      }
    }

    this.preSeekState = (this.playerState === PlayerState.Seeking) ? this.preSeekState : this.playerState;
    this.setPlayerState(PlayerState.Seeking);
    this.mpvManager.setProperty('pause', true);

    this.notifyUI();

    this.mpvManager.sendCommand(['seek', time, 'absolute']);
  }

  public updateSettings(newSettings: ProjectSettings): void {
    const oldSettings = this.settings;
    this.settings = newSettings;

    const rendererChanged = oldSettings && oldSettings.useMpvSubtitles !== newSettings.useMpvSubtitles;
    const visibilityChanged = oldSettings && oldSettings.subtitlesVisible !== newSettings.subtitlesVisible;

    if (visibilityChanged) {
      this.subtitlesVisible = newSettings.subtitlesVisible;
    }

    if (rendererChanged || visibilityChanged) {
      if (rendererChanged) {
        this.mpvSubtitlesHiddenDueToRenderer = false; // Reset this only on renderer change
      }
      this.applyClipTransitionSettings();
      this.notifyUI();
    }
  }

  public updateClips(newClips: VideoClip[]): void {
    const oldClipIndex = this.currentClipIndex;
    this.clips = newClips;

    let newClipIndex;

    if (this.playerState === PlayerState.AutoPausedAtEnd) {
      newClipIndex = this.clips.findIndex(c => c.endTime === this.currentTime);
      if (newClipIndex === -1) {
        // Fallback if not exactly on a clip boundary anymore
        newClipIndex = this.clips.findIndex(c => this.currentTime >= c.startTime && this.currentTime < c.endTime);
      }
    } else {
      newClipIndex = this.clips.findIndex(c => this.currentTime >= c.startTime && this.currentTime < c.endTime);
    }

    if (newClipIndex === -1) {
      // Failsafe: if no clip is found, don't change the index. This prevents state corruption.
      return;
    }

    const indexChanged = newClipIndex !== oldClipIndex;
    this.currentClipIndex = newClipIndex;

    if (indexChanged) {
      this.applyClipTransitionSettings();
    }

    // Always notify the UI after a clip update, because the clip list or state might need syncing.
    this.notifyUI();
  }

  private handleMpvEvent(status: any): void {
    if (status.event === 'property-change' && status.name === 'time-pos' && status.data !== undefined) {
      if (this.playerState === PlayerState.Seeking) {
        return;
      }

      this.currentTime = status.data;
      const currentClip = this.clips[this.currentClipIndex];
      if (this.playerState === PlayerState.Playing && currentClip && this.currentTime >= currentClip.endTime - 0.05) {
        this.handleClipEnd();
      } else {
        this.notifyUI();
      }
    } else if (status.event === 'seek') {
      if (this.playerState === PlayerState.Seeking) {
        const shouldResume = this.preSeekState === PlayerState.Playing;
        const isInitialSeek = this.preSeekState === PlayerState.Idle;

        // Apply final subtitle visibility state now that the seek is complete.
        if (!this.isSeekingWithinSameClip || isInitialSeek) {
          this.applySubtitleVisibilityForClip();
        }

        this.isSeekingWithinSameClip = false;

        this.mpvManager.setProperty('pause', !shouldResume);
        this.setPlayerState(
          shouldResume ? PlayerState.Playing : PlayerState.PausedByUser,
          true
        );
      }
    } else if (status.event === 'end-file') {
      this.setPlayerState(PlayerState.Idle);
    }
  }

  private handleClipEnd(): void {
    const finishedClip = this.clips[this.currentClipIndex];
    if (!finishedClip) {
      return;
    }

    if (finishedClip.hasSubtitle && this.settings?.autoPauseAtEnd) {
      const pauseTime = (finishedClip.endTime - 0.01);
      this.currentTime = pauseTime;
      this.setPlayerState(PlayerState.AutoPausedAtEnd);
      this.mpvManager.setProperty('pause', true);
      this.mpvManager.sendCommand(['seek', pauseTime, 'absolute+exact']);
    } else {
      this.playClipAtIndex(this.currentClipIndex + 1);
    }
  }

  private playClipAtIndex(index: number): void {
    if (index >= this.clips.length) {
      this.setPlayerState(PlayerState.Idle);
      return;
    }

    this.currentClipIndex = index;
    this.userOverriddenClipId = null;
    this.applyClipTransitionSettings();

    const clipToPlay = this.clips[this.currentClipIndex];
    const shouldAutoPauseAtStart = clipToPlay.hasSubtitle && this.settings?.autoPauseAtStart;

    // Determine the precise target time, nudging it slightly if auto-pausing at the start to make sure it's still within clip bounds:
    const targetTime = shouldAutoPauseAtStart ? (clipToPlay.startTime + 0.01) : clipToPlay.startTime;
    this.mpvManager.sendCommand(['seek', targetTime, 'absolute']);

    if (shouldAutoPauseAtStart) {
      this.currentTime = targetTime;
      this.mpvManager.setProperty('pause', true);
      this.setPlayerState(PlayerState.AutoPausedAtStart);
    } else {
      this.mpvManager.setProperty('pause', false);
      this.setPlayerState(PlayerState.Playing, true);
    }
  }

  private applyClipTransitionSettings(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    const speed = clip.hasSubtitle ? this.settings.subtitledClipSpeed : this.settings.gapSpeed;
    this.mpvManager.setProperty('speed', speed);
    this.applySubtitleVisibilityForClip();
  }

  private applySubtitleVisibilityForClip(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    if (this.userOverriddenClipId === clip.id) {
      return;
    }

    if (clip.hasSubtitle) {
      const behavior = this.settings.subtitleBehavior;
      if (behavior === SubtitleBehavior.ForceShow) {
        this.subtitlesVisible = true;
      } else if (behavior === SubtitleBehavior.ForceHide) {
        this.subtitlesVisible = false;
      }
    }

    if (!this.settings.useMpvSubtitles) {
      if (!this.mpvSubtitlesHiddenDueToRenderer) {
        this.mpvManager.hideSubtitles();
        this.mpvSubtitlesHiddenDueToRenderer = true;
      }
    } else {
      this.mpvSubtitlesHiddenDueToRenderer = false;
      if (this.subtitlesVisible) {
        this.mpvManager.showSubtitles();
      } else {
        this.mpvManager.hideSubtitles();
      }
    }
  }

  private setPlayerState(newState: PlayerState, forceNotify: boolean = false) {
    const stateChanged = this.playerState !== newState;
    this.playerState = newState;

    if (stateChanged || forceNotify) {
      this.notifyUI();
    }
  }

  private notifyUI(): void {
    if (!this.isProjectLoaded) {
      return;
    }

    if (this.uiWindow && !this.uiWindow.isDestroyed()) {
      const payload: PlaybackStateUpdate = {
        playerState: this.playerState,
        currentClipIndex: this.currentClipIndex,
        currentTime: this.currentTime,
        isPaused: this.isPaused,
        subtitlesVisible: this.subtitlesVisible,
      };
      this.uiWindow.webContents.send('playback:state-update', payload);
    }
  }
}
