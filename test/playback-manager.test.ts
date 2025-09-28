import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PlaybackManager} from '../playback-manager';
import {PlayerState, VideoClip} from '../src/app/model/video.types';
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
  {id: 'gap-1', startTime: 0, endTime: 10, hasSubtitle: false, duration: 10, parts: [], sourceSubtitles: []},
  {
    id: 'sub-1',
    startTime: 10,
    endTime: 20,
    hasSubtitle: true,
    duration: 10,
    parts: [],
    sourceSubtitles: [{id: 's1', type: 'srt', text: 'A', startTime: 10, endTime: 20}]
  },
  {id: 'gap-2', startTime: 20, endTime: 30, hasSubtitle: false, duration: 10, parts: [], sourceSubtitles: []},
] as VideoClip[];

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

  describe('updateClips', () => {
    const fourClipLayout: VideoClip[] = [
      {id: 'gap-0', startTime: 0, endTime: 5, duration: 5, hasSubtitle: false, parts: [], sourceSubtitles: []},
      {
        id: 'sub-5',
        startTime: 5,
        endTime: 10,
        duration: 5,
        hasSubtitle: true,
        parts: [],
        sourceSubtitles: [{id: 's1', type: 'srt', text: 'A', startTime: 5, endTime: 10}]
      },
      {id: 'gap-10', startTime: 10, endTime: 15, duration: 5, hasSubtitle: false, parts: [], sourceSubtitles: []},
      {
        id: 'sub-15',
        startTime: 15,
        endTime: 20,
        duration: 5,
        hasSubtitle: true,
        parts: [],
        sourceSubtitles: [{id: 's2', type: 'srt', text: 'B', startTime: 15, endTime: 20}]
      },
    ];

    beforeEach(() => {
      playbackManager.loadProject(JSON.parse(JSON.stringify(fourClipLayout)), {} as any);
    });

    it('should correctly re-synchronize the active clip index if the playhead is now in a different clip', () => {
      // ARRANGE: Playhead is at time 8, inside 'sub-5' (index 1)
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 8;
      expect((playbackManager as any).currentClipIndex).toBe(1);

      // ACT: Shrink 'sub-5' so that time 8 is now in 'gap-10'
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[1].id = 'sub-5'; // Keep ID the same for this test
      modifiedClips[1].endTime = 7;
      modifiedClips[2].id = 'gap-7'; // ID changes because start time changes
      modifiedClips[2].startTime = 7;
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The active clip index should now be 2 ('gap-10')
      expect((playbackManager as any).currentClipIndex).toBe(2);
      expect(mockUiWindow.webContents.send).toHaveBeenCalledWith('playback:state-update', expect.objectContaining({currentClipIndex: 2}));
    });

    it('should NOT re-synchronize index if the active clip was not modified', () => {
      // ARRANGE: Playhead is at time 8, inside 'sub-5' (index 1)
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 8;
      expect((playbackManager as any).currentClipIndex).toBe(1);

      // ACT: Modify a completely different clip ('sub-15')
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[3].endTime = 18; // Shrink sub-15
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The index should remain 1, and no notification should be sent for index change
      expect((playbackManager as any).currentClipIndex).toBe(1);
      expect(mockUiWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should preserve the active clip when paused exactly at the END boundary and a different clip is modified', () => {
      // ARRANGE: Paused at the very end of 'sub-5' (index 1)
      (playbackManager as any).playerState = PlayerState.AutoPausedAtEnd;
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 10; // Exactly at the boundary
      expect((playbackManager as any).currentClipIndex).toBe(1);

      // ACT: Modify 'sub-15'
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[3].endTime = 18;
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The index should be preserved at 1, preventing the jump to the next clip.
      expect((playbackManager as any).currentClipIndex).toBe(1);
    });

    it('should preserve the active clip when paused exactly at the START boundary and a different clip is modified', () => {
      // ARRANGE: Paused at the very start of 'gap-10' (index 2)
      (playbackManager as any).playerState = PlayerState.AutoPausedAtStart;
      (playbackManager as any).currentClipIndex = 2;
      (playbackManager as any).currentTime = 10; // Exactly at the boundary
      expect((playbackManager as any).currentClipIndex).toBe(2);

      // ACT: Modify 'sub-15'
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[3].endTime = 18;
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The index should be preserved at 2.
      expect((playbackManager as any).currentClipIndex).toBe(2);
    });

    it('should preserve index when paused at an UNMODIFIED END boundary while active clip start time changes', () => {
      // ARRANGE: Paused at the end of 'sub-5' (index 1)
      (playbackManager as any).playerState = PlayerState.AutoPausedAtEnd;
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 10;

      // ACT: Modify the START time of the active clip, but keep the END time the same.
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[1].startTime = 7; // Start time changed
      modifiedClips[1].id = 'sub-7';  // ID changes as a result
      modifiedClips[0].endTime = 7;   // Preceding gap is adjusted
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The index is preserved because the player was paused at the unchanged endTime boundary.
      expect((playbackManager as any).currentClipIndex).toBe(1);
    });

    it('should preserve index when paused at an UNMODIFIED START boundary while active clip end time changes', () => {
      // ARRANGE: Paused at the start of 'sub-5' (index 1)
      (playbackManager as any).playerState = PlayerState.AutoPausedAtStart;
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 5;

      // ACT: Modify the END time of the active clip, but keep the START time the same.
      const modifiedClips = JSON.parse(JSON.stringify(fourClipLayout));
      modifiedClips[1].endTime = 8; // End time changed
      modifiedClips[2].startTime = 8; // Following gap is adjusted
      modifiedClips[2].id = 'gap-8';
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The index is preserved because the player was paused at the unchanged startTime boundary.
      expect((playbackManager as any).currentClipIndex).toBe(1);
    });
  });
});
