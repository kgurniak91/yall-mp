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
}

export class PlaybackManager {
  private clips: VideoClip[] = [];
  private settings: ProjectSettings | null = null;
  private currentClipIndex = -1;
  private playerState: PlayerState = PlayerState.Idle;
  private currentTime = 0;
  private preSeekState: PlayerState = PlayerState.Idle;

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

  public loadProject(clips: VideoClip[], settings: ProjectSettings): void {
    this.clips = clips;
    this.settings = settings;
    this.currentClipIndex = 0;
    this.currentTime = 0;
    this.setPlayerState(PlayerState.Idle);
  }

  public play(): void {
    if (this.playerState === PlayerState.AutoPausedAtEnd) {
      this.playClipAtIndex(this.currentClipIndex + 1);
    } else {
      this.applyClipSettings();
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

  public repeat(): void {
    const clip = this.clips[this.currentClipIndex];
    if (clip) {
      this.mpvManager.sendCommand(['seek', clip.startTime, 'absolute']);
      this.applyClipSettings();
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
    const targetClipIndex = this.clips.findIndex(c => time >= c.startTime && time < c.endTime);
    if (targetClipIndex === -1 || this.playerState === PlayerState.Seeking) {
      return;
    }

    this.preSeekState = this.playerState;
    this.setPlayerState(PlayerState.Seeking);
    this.mpvManager.setProperty('pause', true);

    this.currentClipIndex = targetClipIndex;
    this.currentTime = time;
    this.notifyUI();

    this.mpvManager.sendCommand(['seek', time, 'absolute']);
    this.applyClipSettings();
  }

  public updateSettings(newSettings: ProjectSettings): void {
    this.settings = newSettings;
    if (this.playerState !== PlayerState.Idle && this.playerState !== PlayerState.Seeking) {
      this.applyClipSettings();
    }
  }

  public updateClips(newClips: VideoClip[]): void {
    this.clips = newClips;
    const newClipIndex = this.clips.findIndex(c => this.currentTime >= c.startTime && this.currentTime < c.endTime);

    if (newClipIndex !== -1 && newClipIndex !== this.currentClipIndex) {
      console.log(`[PlaybackManager] Clips updated. Resynced clip index from ${this.currentClipIndex} to ${newClipIndex}.`);
      this.currentClipIndex = newClipIndex;
      this.applyClipSettings();
      this.notifyUI();
    }
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
        this.mpvManager.setProperty('pause', !shouldResume);
        this.setPlayerState(shouldResume ? PlayerState.Playing : PlayerState.PausedByUser);
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
      this.currentTime = finishedClip.endTime;
      this.setPlayerState(PlayerState.AutoPausedAtEnd);
      this.mpvManager.setProperty('pause', true);
      this.mpvManager.sendCommand(['seek', finishedClip.endTime, 'absolute+exact']);
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
    const clipToPlay = this.clips[this.currentClipIndex];

    this.mpvManager.sendCommand(['seek', clipToPlay.startTime, 'absolute']);
    this.applyClipSettings();

    if (clipToPlay.hasSubtitle && this.settings?.autoPauseAtStart) {
      this.currentTime = clipToPlay.startTime;
      this.mpvManager.setProperty('pause', true);
      this.setPlayerState(PlayerState.AutoPausedAtStart);
    } else {
      this.mpvManager.setProperty('pause', false);
      this.setPlayerState(PlayerState.Playing, true);
    }
  }

  private applyClipSettings(): void {
    const clip = this.clips[this.currentClipIndex];
    if (!clip || !this.settings) {
      return;
    }

    const newSpeed = clip.hasSubtitle ? this.settings.subtitledClipSpeed : this.settings.gapSpeed;
    this.mpvManager.setProperty('speed', newSpeed);

    const behavior = this.settings.subtitleBehavior;
    if (clip.hasSubtitle) {
      if (behavior === SubtitleBehavior.ForceShow) {
        this.mpvManager.setProperty('sub-visibility', true);
      } else if (behavior === SubtitleBehavior.ForceHide) {
        this.mpvManager.setProperty('sub-visibility', false);
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
    if (this.uiWindow && !this.uiWindow.isDestroyed()) {
      const payload: PlaybackStateUpdate = {
        playerState: this.playerState,
        currentClipIndex: this.currentClipIndex,
        currentTime: this.currentTime,
        isPaused: this.isPaused,
      };
      this.uiWindow.webContents.send('playback:state-update', payload);
    }
  }
}
