import {MpvManager} from './mpv-manager';
import {LightweightVideoClip, PlayerState} from './src/app/model/video.types';
import type {ProjectSettings} from './src/app/model/settings.types';
import {SubtitleBehavior} from './src/app/model/settings.types';
import {BrowserWindow} from 'electron';
import {EventEmitter} from 'events';

export interface PlaybackStateUpdate {
  playerState: PlayerState;
  currentClipIndex: number;
  currentTime: number;
  isPaused: boolean;
  subtitlesVisible: boolean;
  volume: number;
  isMuted: boolean;
}

export class PlaybackManager extends EventEmitter {
  private clips: LightweightVideoClip[] = [];
  private settings: ProjectSettings | null = null;
  private currentClipIndex = -1;
  private playerState: PlayerState = PlayerState.Idle;
  private currentTime = 0;
  private duration = 0;
  private preSeekState: PlayerState = PlayerState.Idle;
  private userOverriddenClipId: string | null = null;
  private subtitlesVisible: boolean = true;
  private isSeekingWithinSameClip = false;
  private mpvSubtitlesHiddenDueToRenderer = false;
  private isProjectLoaded = false;
  private isAwaitingRepeatSeek = false;
  private isSeekForNavigation = false;
  private nextPlayerState: PlayerState | null = null;
  private isSpeedOverridden = false;
  private currentAutoPauseToken: string = '';
  private volume = 100;
  private isMuted = false;

  constructor(
    private mpvManager: MpvManager,
    private uiWindow: BrowserWindow,
  ) {
    super();
    this.mpvManager.on('status', (status) => this.handleMpvEvent(status));
  }

  public setInitialVolumeState(volume: number, isMuted: boolean): void {
    this.volume = volume;
    this.isMuted = isMuted;
  }

  public get isPaused(): boolean {
    switch (this.playerState) {
      case PlayerState.Playing:
        return false;
      default:
        return true;
    }
  }

  public loadProject(clips: LightweightVideoClip[], settings: ProjectSettings, lastPlaybackTime: number): void {
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
      this.playClipAtIndex(this.getNextClipIndex(this.currentClipIndex));
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
      this.isAwaitingRepeatSeek = true;
      this.setPlayerState(PlayerState.Transitioning);
      this.nextPlayerState = PlayerState.Playing;
      this.mpvManager.setProperty('pause', true);
      this.mpvManager.sendCommand(['seek', clip.startTime, 'absolute']);
      this.refreshLuaAutoPause();
    }
  }

  public forceContinue(): void {
    if (this.isPaused) {
      this.play();
    }
  }

  public seek(time: number, isNavigation: boolean = false): void {
    const targetClipIndex = this.clips.findIndex(
      (c) => time >= c.startTime && time < c.endTime
    );
    if (targetClipIndex === -1) {
      return;
    }

    const oldClipIndex = this.currentClipIndex;
    this.isSeekingWithinSameClip = (oldClipIndex === targetClipIndex);
    this.isSeekForNavigation = isNavigation;

    this.currentClipIndex = targetClipIndex;
    this.currentTime = time;

    // Apply speed setting immediately for the new clip to prevent race condition
    const clip = this.clips[this.currentClipIndex];
    if (clip && this.settings) {
      const speed = this.getTargetSpeedForClip(clip);
      this.mpvManager.setProperty('speed', speed);
      this.refreshLuaAutoPause();
    }

    // Handle anti-flicker hide for subtitles if moving to a new clip
    if (!this.isSeekingWithinSameClip) {
      this.userOverriddenClipId = null;
      if (this.settings?.useMpvSubtitles) {
        this.mpvManager.hideSubtitles();
      }
    }

    if (this.playerState !== PlayerState.Transitioning) {
      this.preSeekState = this.playerState;
    }
    this.setPlayerState(PlayerState.Transitioning);
    this.mpvManager.setProperty('pause', true);

    this.notifyUI();

    this.mpvManager.sendCommand(['seek', time, 'absolute']);
  }

  public updateSettings(newSettings: ProjectSettings): void {
    const oldSettings = this.settings;
    this.settings = newSettings;

    const rendererChanged = oldSettings && oldSettings.useMpvSubtitles !== newSettings.useMpvSubtitles;
    const visibilityChanged = oldSettings && oldSettings.subtitlesVisible !== newSettings.subtitlesVisible;
    const speedChanged = oldSettings && (
      oldSettings.subtitledClipSpeed !== newSettings.subtitledClipSpeed ||
      oldSettings.gapSpeed !== newSettings.gapSpeed ||
      oldSettings.speedOverride !== newSettings.speedOverride
    );

    if (visibilityChanged) {
      this.subtitlesVisible = newSettings.subtitlesVisible;
    }

    if (rendererChanged || visibilityChanged || speedChanged) {
      if (rendererChanged) {
        this.mpvSubtitlesHiddenDueToRenderer = false; // Reset this only on renderer change
      }
      this.applyClipTransitionSettings();

      // Flush MPV audio buffer if speed was changed while paused to prevent audio bursts
      if (speedChanged && this.isPaused) {
        this.mpvManager.sendCommand(['seek', this.currentTime, 'absolute', 'exact']);
      }

      this.notifyUI();
    }
  }

  public updateClips(newClips: LightweightVideoClip[], newTime?: number): void {
    const oldClip = this.clips[this.currentClipIndex];
    const oldStartTime = oldClip?.startTime;
    const oldEndTime = oldClip?.endTime;
    const oldClipIndex = this.currentClipIndex;

    this.clips = newClips;

    if (newTime != null) {
      this.currentTime = newTime;
    }

    let newClipIndex: number;
    if (this.playerState === PlayerState.Ended) {
      newClipIndex = (this.clips.length - 1); // If media file ended, always stay on the last clip
    } else if (this.playerState === PlayerState.AutoPausedAtEnd) {
      newClipIndex = this.clips.findIndex(c => Math.abs(c.endTime - this.currentTime) < 0.02);
    } else if (this.playerState === PlayerState.AutoPausedAtStart) {
      newClipIndex = this.clips.findIndex(c => Math.abs(c.startTime - this.currentTime) < 0.02);
    } else {
      newClipIndex = this.clips.findIndex(c => this.currentTime >= c.startTime && this.currentTime < c.endTime);
    }

    if (newClipIndex === -1) {
      if (Math.abs(this.currentTime - this.duration) < 0.01) {
        // If the playback is almost exactly at the end of file, default to the last clip
        newClipIndex = (this.clips.length - 1);
      } else {
        // Fallback if not exactly on a clip boundary anymore
        newClipIndex = this.clips.findIndex(c => this.currentTime >= c.startTime && this.currentTime < c.endTime);
      }
    }

    if (newClipIndex === -1) {
      // Failsafe: if no clip is found, don't change the index. This prevents state corruption.
      // But still notify the UI with the updated clips list.
      this.notifyUI();
      return;
    }

    const indexChanged = (newClipIndex !== oldClipIndex);
    this.currentClipIndex = newClipIndex;

    // Notify Lua script if index of clip changed OR boundaries of current clip changed
    const newClip = this.clips[this.currentClipIndex];
    const boundaryChanged = newClip ? (Math.abs(newClip.startTime - (oldStartTime ?? 0)) > 0.02 || Math.abs(newClip.endTime - (oldEndTime ?? 0)) > 0.02) : false;
    const typeChanged = Boolean(oldClip?.hasSubtitle) !== Boolean(newClip?.hasSubtitle);

    // If the user had manually changed subtitled clip settings, preserve the override as long as he lands in a subtitled clip.
    if (this.userOverriddenClipId && newClip?.hasSubtitle) {
      if (boundaryChanged || indexChanged) {
        this.userOverriddenClipId = newClip.id;
      }
    }

    if (indexChanged || typeChanged) {
      this.applyClipTransitionSettings();
    } else if (boundaryChanged) {
      this.refreshLuaAutoPause();
    }

    // If user edited current clip boundaries when auto-paused, verify if playhead is still within boundaries and act accordingly
    if (this.playerState === PlayerState.AutoPausedAtEnd || this.playerState === PlayerState.AutoPausedAtStart) {
      const clip = this.clips[this.currentClipIndex];
      if (clip) {
        const isStillAtEnd = Math.abs(this.currentTime - (clip.endTime - 0.01)) < 0.02;
        const isStillAtStart = Math.abs(this.currentTime - (clip.startTime + 0.01)) < 0.02;

        if (!isStillAtEnd && !isStillAtStart) {
          this.setPlayerState(PlayerState.PausedByUser);
        }
      }
    }

    // Always notify the UI after a clip update, because the clip list or state might need syncing.
    this.notifyUI();
  }

  public setSpeedOverride(isActive: boolean): void {
    if (this.isSpeedOverridden === isActive) {
      return;
    }
    this.isSpeedOverridden = isActive;
    this.applyClipTransitionSettings();

    // Flush MPV audio buffer if speed override is toggled while paused
    if (this.isPaused) {
      this.mpvManager.sendCommand(['seek', this.currentTime, 'absolute', 'exact']);
    }
  }

  public setVolume(volume: number): void {
    this.mpvManager.setProperty('volume', volume);
  }

  public setMute(mute: boolean): void {
    this.mpvManager.setProperty('mute', mute);
  }

  private handleMpvEvent(status: any): void {
    if (status.event === 'auto-pause-fired') {
      const token = status.data;
      if (token !== this.currentAutoPauseToken) {
        console.log('[PlaybackManager] Ignored stale auto-pause event.');
        return;
      }

      // Manually snap the playhead to the end of the clip for visual accuracy
      const currentClip = this.clips[this.currentClipIndex];
      if (currentClip) {
        this.currentTime = currentClip.endTime - 0.01;
      }

      const nextIndex = this.getNextClipIndex(this.currentClipIndex);
      const noMoreSubtitles = this.settings?.skipGaps && nextIndex >= this.clips.length;

      if ((this.settings?.autoPauseAtEnd && currentClip?.hasSubtitle) || noMoreSubtitles) {
        this.setPlayerState(PlayerState.AutoPausedAtEnd);
        this.notifyUI();
      } else {
        if (this.playerState === PlayerState.PausedByUser) {
          return;
        }
        this.playClipAtIndex(nextIndex);
      }

      return;
    }

    if (status.event === 'property-change') {
      // Track duration
      if (status.name === 'duration') {
        this.duration = status.data;
      }

      // Handle end of file
      if (status.name === 'eof-reached' && status.data === true) {
        console.log('[PlaybackManager] End of file reached.');
        this.currentTime = this.duration;
        this.setPlayerState(PlayerState.Ended);
        this.mpvManager.setProperty('pause', true);
        return;
      }

      // Handle external pause (e.g. buffering, OS event, EOF side-effects, Lua script)
      if (status.name === 'pause' && status.data === true) {
        if (this.playerState === PlayerState.Playing) {
          this.setPlayerState(PlayerState.PausedBySystem);
        }
      }

      // Handle volume updates
      if (status.name === 'volume' && status.data !== undefined) {
        this.volume = status.data;
        this.notifyUI();
      }

      // Handle mute updates
      if (status.name === 'mute' && status.data !== undefined) {
        this.isMuted = status.data;
        this.notifyUI();
      }

      // Handle time updates
      if (status.name === 'time-pos' && status.data !== undefined) {
        if (this.playerState === PlayerState.Seeking || this.playerState === PlayerState.Transitioning) {
          return;
        }

        // Ignore minor updates from MPV when the player is already auto-paused
        if (this.playerState === PlayerState.AutoPausedAtEnd) {
          const currentClip = this.clips[this.currentClipIndex];
          if (currentClip && Math.abs(status.data - currentClip.endTime) < 0.03) {
            return;
          }
        }

        this.currentTime = status.data;
        this.notifyUI();
      }
    }

    if (status.event === 'seek') {
      if (this.isAwaitingRepeatSeek) {
        this.isAwaitingRepeatSeek = false;
        this.emit('repeat-seek-completed');
      }

      if (this.playerState === PlayerState.Seeking || this.playerState === PlayerState.Transitioning) {
        let shouldResume: boolean;
        let newState: PlayerState;

        if (this.nextPlayerState) {
          // Transition driven by logic (e.g. playClipAtIndex)
          newState = this.nextPlayerState;
          shouldResume = (newState === PlayerState.Playing);
          this.nextPlayerState = null;
        } else {
          const targetClip = this.clips[this.currentClipIndex];
          const destinationRequiresPause = targetClip?.hasSubtitle && this.settings?.autoPauseAtStart;

          if (this.isSeekForNavigation) {
            // Jump to specific subtitled clip (e.g., CTRL + right arrow)
            // Always apply correct clip settings, even if the player was previously paused
            if (targetClip?.hasSubtitle) {
              shouldResume = !destinationRequiresPause;
              newState = shouldResume ? PlayerState.Playing : PlayerState.AutoPausedAtStart;
            } else {
              shouldResume = true;
              newState = PlayerState.Playing;
            }
          } else {
            // Manual seek (e.g., right arrow, timeline click)
            // Preserve the playing/paused status from before the seek
            shouldResume = (this.preSeekState === PlayerState.Playing);
            newState = shouldResume ? PlayerState.Playing : PlayerState.PausedByUser;
          }

          this.isSeekForNavigation = false;
          const isInitialSeek = this.preSeekState === PlayerState.Idle;

          // Apply final subtitle visibility state now that the seek is complete
          if (!this.isSeekingWithinSameClip || isInitialSeek) {
            this.applySubtitleVisibilityForClip();
          }

          this.isSeekingWithinSameClip = false;
        }

        this.mpvManager.setProperty('pause', !shouldResume);
        this.setPlayerState(newState, true);
      }
    } else if (status.event === 'end-file') {
      // This must stay as Idle, not Ended, because it happens when mpv unloads the file completely during teardown:
      this.setPlayerState(PlayerState.Idle);
    }
  }

  private getNextClipIndex(currentIndex: number): number {
    let nextIndex = currentIndex + 1;
    if (this.settings?.skipGaps) {
      while (nextIndex < this.clips.length && !this.clips[nextIndex].hasSubtitle) {
        nextIndex++;
      }
    }
    return nextIndex;
  }

  private playClipAtIndex(index: number): void {
    if (index >= this.clips.length) {
      this.setPlayerState(PlayerState.Ended);
      return;
    }

    this.setPlayerState(PlayerState.Transitioning);
    this.mpvManager.setProperty('pause', true);

    this.currentClipIndex = index;
    this.userOverriddenClipId = null;
    this.applyClipTransitionSettings();

    const clipToPlay = this.clips[this.currentClipIndex];
    const shouldAutoPauseAtStart = clipToPlay.hasSubtitle && this.settings?.autoPauseAtStart;

    // Determine the precise target time, nudging it slightly if auto-pausing at the start to make sure it's still within clip bounds:
    const targetTime = shouldAutoPauseAtStart ? (clipToPlay.startTime + 0.01) : clipToPlay.startTime;
    this.currentTime = targetTime;
    this.notifyUI();

    this.mpvManager.sendCommand(['seek', targetTime, 'absolute']);

    if (shouldAutoPauseAtStart) {
      this.nextPlayerState = PlayerState.AutoPausedAtStart;
    } else {
      this.nextPlayerState = PlayerState.Playing;
    }
  }

  private applyClipTransitionSettings(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    const speed = this.getTargetSpeedForClip(clip);
    this.mpvManager.setProperty('speed', speed);

    this.refreshLuaAutoPause();
    this.applySubtitleVisibilityForClip();
  }

  private getTargetSpeedForClip(clip: LightweightVideoClip) {
    if (!this.settings) {
      return 1.0;
    }

    // Priority 1: User override (Shift held down)
    if (this.isSpeedOverridden) {
      return this.settings.speedOverride;
    }

    // Priority 2: Context-aware speed
    return clip.hasSubtitle ? this.settings.subtitledClipSpeed : this.settings.gapSpeed;
  }

  private refreshLuaAutoPause(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    // Generate a new token whenever the active clip context changes (seek, speed change, clip update)
    this.currentAutoPauseToken = Math.random().toString(36).substring(2);
    this.mpvManager.setLuaAutoPause(clip.endTime, this.currentAutoPauseToken);
  }

  private applySubtitleVisibilityForClip(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    if (this.userOverriddenClipId !== clip.id) {
      if (clip.hasSubtitle) {
        const behavior = this.settings.subtitleBehavior;
        if (behavior === SubtitleBehavior.ForceShow) {
          this.subtitlesVisible = true;
        } else if (behavior === SubtitleBehavior.ForceHide) {
          this.subtitlesVisible = false;
        }
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
        volume: this.volume,
        isMuted: this.isMuted,
      };
      this.uiWindow.webContents.send('playback:state-update', payload);
    }
  }
}
