import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PlaybackManager} from '../playback-manager';
import {PlayerState} from '../src/app/model/video.types';
import {MpvManager} from '../mpv-manager';
import type {BrowserWindow} from 'electron';

const mockMpvManager = {
  on: vi.fn(),
  setProperty: vi.fn(),
  sendCommand: vi.fn(),
};

const mockUiWindow = {
  isDestroyed: () => false,
  webContents: {
    send: vi.fn(),
  },
};

const mockClips = [
  {id: 'gap-1', startTime: 0, endTime: 10, hasSubtitle: false},
  {id: 'sub-1', startTime: 10, endTime: 20, hasSubtitle: true},
  {id: 'gap-2', startTime: 20, endTime: 30, hasSubtitle: false},
];

describe('PlaybackManager', () => {
  let playbackManager: PlaybackManager;

  const setupManager = (settings: any) => {
    const manager = new PlaybackManager(mockMpvManager as unknown as MpvManager, mockUiWindow as unknown as BrowserWindow);
    manager.loadProject(mockClips as any, settings);
    return manager;
  };

  const simulateMpvEvent = (manager: PlaybackManager, event: any) => (manager as any).handleMpvEvent(event);
  const simulateTimePassing = (manager: PlaybackManager, time: number) => simulateMpvEvent(manager, {
    event: 'property-change',
    name: 'time-pos',
    data: time
  });
  const simulateSeekComplete = (manager: PlaybackManager) => simulateMpvEvent(manager, {event: 'seek'});
  const simulateEndOfClip = (manager: PlaybackManager, time: number) => simulateTimePassing(manager, time - 0.05);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('User Action: Seeking', () => {
    it('seeks to a subtitled clip, applies correct speed, and remains paused', () => {
      playbackManager = setupManager({subtitledClipSpeed: 1.0});

      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 15, 'absolute']);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
      expect(mockMpvManager.setProperty).toHaveBeenLastCalledWith('pause', true);
      expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({playerState: PlayerState.PausedByUser}));
    });
  });

  describe('Automatic Clip Transitions', () => {
    const baseSettings = {subtitledClipSpeed: 1.0, gapSpeed: 3.0};

    describe('[Continuous Play: autoPause Start=false, End=false]', () => {
      beforeEach(() => {
        playbackManager = setupManager({...baseSettings, autoPauseAtStart: false, autoPauseAtEnd: false});
        playbackManager.seek(5);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();
      });

      it('transitions GAP -> SUBTITLED and plays immediately with correct speed', () => {
        simulateEndOfClip(playbackManager, 10);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 1
        }));
      });

      it('transitions SUBTITLED -> GAP and plays immediately with correct speed', () => {
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 20);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 3.0);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 2
        }));
      });
    });

    describe('[Full Step: autoPause Start=true, End=true]', () => {
      beforeEach(() => {
        playbackManager = setupManager({...baseSettings, autoPauseAtStart: true, autoPauseAtEnd: true});
        playbackManager.seek(5);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();
      });

      it('transitions GAP -> SUBTITLED and pauses at the start', () => {
        simulateEndOfClip(playbackManager, 10);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.AutoPausedAtStart,
          currentClipIndex: 1
        }));
      });

      it('pauses at the end of a SUBTITLED clip and does not transition', () => {
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 20);
        expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 20, 'absolute+exact']);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.AutoPausedAtEnd,
          currentClipIndex: 1
        }));
      });

      it('reports the precise endTime when pausing at the end of a clip', () => {
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 20);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          currentTime: 20.0
        }));
      });
    });

    describe('[Pause At End Only: autoPause Start=false, End=true]', () => {
      beforeEach(() => {
        playbackManager = setupManager({...baseSettings, autoPauseAtStart: false, autoPauseAtEnd: true});
        playbackManager.seek(5);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();
      });

      it('transitions GAP -> SUBTITLED and plays immediately', () => {
        simulateEndOfClip(playbackManager, 10);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 1
        }));
      });

      it('pauses at the end of a SUBTITLED clip', () => {
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 20);
        expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 20, 'absolute+exact']);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.AutoPausedAtEnd,
          currentClipIndex: 1
        }));
      });
    });

    describe('[Pause At Start Only: autoPause Start=true, End=false]', () => {
      beforeEach(() => {
        playbackManager = setupManager({...baseSettings, autoPauseAtStart: true, autoPauseAtEnd: false});
        playbackManager.seek(5);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();
      });

      it('transitions GAP -> SUBTITLED and pauses at the start', () => {
        simulateEndOfClip(playbackManager, 10);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.AutoPausedAtStart,
          currentClipIndex: 1
        }));
      });

      it('transitions SUBTITLED -> GAP and plays immediately', () => {
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 20);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 3.0);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 2
        }));
      });
    });
  });
});
