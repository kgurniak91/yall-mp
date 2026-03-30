import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PlaybackManager, PlaybackStateUpdate} from '../playback-manager';
import {LightweightVideoClip, PlayerState, VideoClip} from '../src/app/model/video.types';
import {MpvManager} from '../mpv-manager';
import type {BrowserWindow} from 'electron';
import {DEFAULT_PROJECT_SETTINGS, ProjectSettings, SubtitleBehavior} from '../src/app/model/settings.types';
import {cloneDeep} from 'lodash-es';

const mockMpvManager = {
  on: vi.fn(),
  setProperty: vi.fn(),
  sendCommand: vi.fn(),
  showSubtitles: vi.fn(),
  hideSubtitles: vi.fn(),
  setLuaAutoPause: vi.fn()
};

const mockUiWindow = {
  isDestroyed: () => false,
  webContents: {
    send: vi.fn(),
  },
};

const mockClips: LightweightVideoClip[] = [
  {id: 'gap-1', startTime: 0, endTime: 10, hasSubtitle: false},
  {id: 'sub-1', startTime: 10, endTime: 20, hasSubtitle: true},
  {id: 'gap-2', startTime: 20, endTime: 30, hasSubtitle: false},
  {id: 'sub-15', startTime: 30, endTime: 40, hasSubtitle: true}
];

const getLastStateUpdate = (): PlaybackStateUpdate | undefined => {
  const calls = mockUiWindow.webContents.send.mock.calls;
  if (calls.length === 0) return undefined;
  // Find the last call that was a 'playback:state-update'
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i][0] === 'playback:state-update') {
      return calls[i][1];
    }
  }
  return undefined;
};

describe('PlaybackManager', () => {
  let playbackManager: PlaybackManager;

  const setupManager = (settings: Partial<ProjectSettings> = {}, startTime = 0) => {
    const fullSettings = {...DEFAULT_PROJECT_SETTINGS, ...settings};
    const manager = new PlaybackManager(mockMpvManager as unknown as MpvManager, mockUiWindow as unknown as BrowserWindow);
    manager.loadProject(cloneDeep(mockClips), fullSettings, startTime, {enabled: false, speed: 1.0});
    return manager;
  };

  const simulateMpvEvent = (manager: PlaybackManager, event: any) => (manager as any).handleMpvEvent(event);
  const simulateSeekComplete = (manager: PlaybackManager) => simulateMpvEvent(manager, {event: 'seek'});

  const simulateEndOfClip = (manager: PlaybackManager, time: number) => {
    (manager as any).currentTime = time;

    const index = (manager as any).currentClipIndex;
    const clip = (manager as any).clips[index];
    const settings = (manager as any).settings;
    const shouldAutoPause = clip && clip.hasSubtitle && settings?.autoPauseAtEnd;

    const token = (manager as any).currentAutoPauseToken;
    simulateMpvEvent(manager, {event: 'auto-pause-fired', data: token});

    // If auto-pause is disabled, the manager will trigger a seek to the next clip.
    // Simulate completion of that seek to reach the final expected state.
    if (!shouldAutoPause) {
      simulateSeekComplete(manager);
    }
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Project Loading', () => {
    it('should restore subtitle visibility from project settings upon loading', () => {
      // ARRANGE: Create settings where subtitles are explicitly set to be hidden
      const settingsWithSubsHidden: Partial<ProjectSettings> = {
        subtitlesVisible: false,
      };

      // ACT: Load a new project with these settings using the helper
      playbackManager = setupManager(settingsWithSubsHidden);

      // ASSERT: The internal state and the initial UI notification should both reflect that subtitles are hidden.
      expect((playbackManager as any).subtitlesVisible).toBe(false);
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
    });

    it('should apply correct settings on the first seek after loading', () => {
      // ARRANGE: Create a manager and load a project, which primes the state but doesn't apply settings yet
      const manager = new PlaybackManager(mockMpvManager as unknown as MpvManager, mockUiWindow as unknown as BrowserWindow);
      const settings = {...DEFAULT_PROJECT_SETTINGS, subtitledClipSpeed: 1.0, gapSpeed: 3.0};
      const lastPlaybackTime = 15; // A time inside the subtitled clip 'sub-1'
      manager.loadProject(cloneDeep(mockClips), settings, lastPlaybackTime, {enabled: false, speed: 1.0});

      // Sanity check: no settings should have been applied during load
      expect(mockMpvManager.setProperty).not.toHaveBeenCalled();

      // ACT: Perform the initial seek, which mimics what the UI does on startup
      manager.seek(lastPlaybackTime);
      simulateSeekComplete(manager);

      // ASSERT: The speed for the subtitled clip (1.0) should have been applied now
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
      expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('speed', 3.0); // Should NOT have applied gap speed
    });
  });

  describe('Settings updates', () => {
    it('should correctly apply updated subtitle visibility setting during playback', () => {
      // ARRANGE: Start with subs visible
      playbackManager = setupManager({subtitlesVisible: true});
      expect((playbackManager as any).subtitlesVisible).toBe(true);

      // ACT: Update settings to hide subtitles
      const newSettings = {...(playbackManager as any).settings, subtitlesVisible: false};
      playbackManager.updateSettings(newSettings);

      // ASSERT: The internal state should now be false, and the UI should be notified
      expect((playbackManager as any).subtitlesVisible).toBe(false);
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);

      // ACT 2: Update settings to show subtitles again
      const newerSettings = {...(playbackManager as any).settings, subtitlesVisible: true};
      playbackManager.updateSettings(newerSettings);

      // ASSERT 2: The state should flip back to true
      expect((playbackManager as any).subtitlesVisible).toBe(true);
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
    });

    it('should instantly apply new playback speeds when updated in settings without requiring a seek', () => {
      // ARRANGE: Start paused in the middle of a subtitled clip with 1.0x speed
      playbackManager = setupManager({subtitledClipSpeed: 1.0, gapSpeed: 2.0});
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.pause();
      vi.clearAllMocks();

      // ACT: User changes the subtitled clip speed to 5.0x in settings
      const newSettings = {...(playbackManager as any).settings, subtitledClipSpeed: 5.0};
      playbackManager.updateSettings(newSettings);

      // ASSERT 1: The new speed should be sent to MPV immediately
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 5.0);

      // ACT 2: User repeats the clip
      playbackManager.repeat();
      simulateSeekComplete(playbackManager);

      // ASSERT 2: The player should still be respecting the 5.0x speed
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 5.0);
    });

    it('should force a buffer flush (exact absolute seek) when speed is changed while paused to prevent audio bursts', () => {
      // ARRANGE
      playbackManager = setupManager({subtitledClipSpeed: 5.0, gapSpeed: 2.0});
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.pause();
      vi.clearAllMocks();

      // ACT
      const newSettings = {...(playbackManager as any).settings, subtitledClipSpeed: 1.0};
      playbackManager.updateSettings(newSettings);

      // ASSERT
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 15, 'absolute', 'exact']);
    });
  });

  describe('User Action: Playback Start', () => {
    it('should apply correct settings for the first clip when starting playback from idle', () => {
      // ARRANGE: Setup with a fast gap speed. The first clip is a gap.
      playbackManager = setupManager({gapSpeed: 3.0, subtitledClipSpeed: 1.0});
      vi.clearAllMocks(); // Clear mocks after setup to isolate the 'play' action

      // ACT: Start playback from the beginning.
      playbackManager.play();

      // ASSERT: The correct speed for the gap clip should have been applied.
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 3.0);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      expect(getLastStateUpdate()).toEqual(expect.objectContaining({playerState: PlayerState.Playing}));
    });
  });

  describe('User Action: Seeking', () => {
    it('seeks to a subtitled clip, applies correct speed, and remains paused', () => {
      playbackManager = setupManager({subtitledClipSpeed: 1.0});

      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 15, 'absolute']);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
      expect(mockMpvManager.setProperty).toHaveBeenLastCalledWith('pause', true);
      expect(getLastStateUpdate()).toEqual(expect.objectContaining({playerState: PlayerState.PausedByUser}));
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
          currentTime: 19.99
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
          playerState: PlayerState.AutoPausedAtStart,
          currentClipIndex: 1
        }));
      });

      it('seeks to slightly after the start time when auto-pausing at the start', () => {
        simulateEndOfClip(playbackManager, 10);
        // The subtitled clip starts at 10.0 so the playback indicator should pause at 10.0 + 0.01
        expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 10.01, 'absolute']);
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
          currentTime: 10.01
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
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 2
        }));
      });
    });
  });

  describe('User Action: Repeat Clip', () => {
    beforeEach(() => {
      playbackManager = setupManager();
    });

    it('should rewind to the start and play the clip if paused mid-clip', () => {
      // ARRANGE: Seek to the middle of a subtitled clip and ensure it's paused.
      playbackManager.seek(15); // In sub-1 (10s to 20s)
      simulateSeekComplete(playbackManager);
      playbackManager.pause(); // Explicitly pause
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
      vi.clearAllMocks();

      // ACT: Call the repeat method
      playbackManager.repeat();
      simulateSeekComplete(playbackManager);

      // ASSERT:
      // It should seek to the beginning of the current clip (sub-1 starts at 10s).
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 10, 'absolute']);
      // It should unpause the player.
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      // The final state should be 'Playing'.
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
    });

    it('should rewind to the start and continue playing if already playing mid-clip', () => {
      // ARRANGE: Seek to the middle of a subtitled clip and start playing.
      playbackManager.seek(15); // In sub-1
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
      vi.clearAllMocks();

      // ACT: Call the repeat method
      playbackManager.repeat();
      simulateSeekComplete(playbackManager);

      // ASSERT:
      // It should seek to the beginning of the current clip.
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 10, 'absolute']);
      // It should ensure the player is playing.
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      // The final state should still be 'Playing'.
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
    });

    it('should rewind to the start and play the clip if auto-paused at the end of the clip', () => {
      // ARRANGE: Set up a manager that auto-pauses at the end.
      playbackManager = setupManager({autoPauseAtEnd: true});

      // Go to the end of sub-1 (ends at 20s) and simulate the auto-pause.
      (playbackManager as any).currentClipIndex = 1; // Manually set clip to sub-1
      simulateEndOfClip(playbackManager, 20);

      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
      vi.clearAllMocks();

      // ACT: Call the repeat method
      playbackManager.repeat();
      simulateSeekComplete(playbackManager);

      // ASSERT:
      // It should seek to the beginning of the current clip (sub-1 starts at 10s).
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 10, 'absolute']);
      // It should unpause the player.
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      // The final state should be 'Playing'.
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
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
        sourceSubtitles: [{id: 's1', type: 'srt', text: 'A', startTime: 5, endTime: 10, track: 0}]
      },
      {id: 'gap-10', startTime: 10, endTime: 15, duration: 5, hasSubtitle: false, parts: [], sourceSubtitles: []},
      {
        id: 'sub-15',
        startTime: 15,
        endTime: 20,
        duration: 5,
        hasSubtitle: true,
        parts: [],
        sourceSubtitles: [{id: 's2', type: 'srt', text: 'B', startTime: 15, endTime: 20, track: 0}]
      },
    ];

    beforeEach(() => {
      playbackManager = new PlaybackManager(mockMpvManager as unknown as MpvManager, mockUiWindow as unknown as BrowserWindow);
      playbackManager.loadProject(JSON.parse(JSON.stringify(fourClipLayout)), {} as ProjectSettings, 0, {
        enabled: false,
        speed: 1.0
      });
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
      expect(getLastStateUpdate()).toEqual(expect.objectContaining({currentClipIndex: 2}));
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
      // A notification IS sent to keep UI in sync, but it shouldn't contain an index change
      expect(getLastStateUpdate()?.currentClipIndex).toBe(1);
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

    it('should preserve active clip and subtitle visibility when paused at end and a clip boundary is modified', () => {
      // ARRANGE: Setup with auto-pause at end. Be paused at the end of a subtitled clip. Subs are visible.
      playbackManager = setupManager({useMpvSubtitles: true, autoPauseAtEnd: true, subtitlesVisible: true});
      (playbackManager as any).playerState = PlayerState.AutoPausedAtEnd;
      (playbackManager as any).currentClipIndex = 1; // sub-1
      (playbackManager as any).currentTime = 20; // At the very end of sub-1
      (playbackManager as any).subtitlesVisible = true;
      vi.clearAllMocks();

      // ACT: Modify the START time of the current clip, but keep the END time the same.
      const modifiedClips = JSON.parse(JSON.stringify(mockClips));
      modifiedClips[1].startTime = 12; // Start time is now 12 instead of 10
      modifiedClips[0].endTime = 12;   // Previous gap is now longer
      playbackManager.updateClips(modifiedClips);

      // ASSERT: The clip index should be preserved, and no "hide subtitles" command should have been sent.
      expect((playbackManager as any).currentClipIndex).toBe(1);
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
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

  describe('Adjusting Clip Boundaries while Subtitles are Manually Overridden', () => {
    it('should preserve manual subtitle visibility override when shrinking right edge while auto-paused at end', () => {
      playbackManager = setupManager({
        useMpvSubtitles: true,
        subtitleBehavior: SubtitleBehavior.ForceHide,
        autoPauseAtEnd: true
      });
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.toggleSubtitles(); // Manual override ON
      vi.clearAllMocks();

      // Reach the end of the clip (20s)
      (playbackManager as any).currentClipIndex = 1;
      simulateEndOfClip(playbackManager, 20); // Time is now 19.99

      // The override should still be active
      expect((playbackManager as any).subtitlesVisible).toBe(true);
      vi.clearAllMocks();

      // Simulate shrinking the right edge to 18s.
      // The frontend will snap the time to 17.99s.
      const modifiedClips = cloneDeep(mockClips);
      modifiedClips[1].endTime = 18;
      modifiedClips[2].startTime = 18;

      playbackManager.updateClips(modifiedClips, 17.99);

      // Visibility should be preserved
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect((playbackManager as any).subtitlesVisible).toBe(true);
      expect((playbackManager as any).userOverriddenClipId).toBe('sub-1');
    });

    it('should preserve manual subtitle visibility override when a clip is split', () => {
      playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
      playbackManager.seek(15); // middle of sub-1 (10-20)
      simulateSeekComplete(playbackManager);
      playbackManager.toggleSubtitles(); // Manual override ON
      vi.clearAllMocks();

      // Simulate splitting the clip at 15s
      const modifiedClips = cloneDeep(mockClips);
      // original: gap-1(0-10), sub-1(10-20), gap-2(20-30)
      // new: gap-1(0-10), sub-1(10-15), sub-15_new(15-20), gap-2(20-30)
      modifiedClips.splice(2, 0, {
        id: 'sub-15_new',
        startTime: 15,
        endTime: 20,
        hasSubtitle: true
      });
      modifiedClips[1].endTime = 15;

      // Update clips and pass newTime = 16 to simulate jumping into the right half
      playbackManager.updateClips(modifiedClips, 16);

      // The index changed from 1 to 2, but it's a split of the same logical clip.
      // So it should preserve the manual override.
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect((playbackManager as any).subtitlesVisible).toBe(true);
      expect((playbackManager as any).userOverriddenClipId).toBe('sub-15_new');
    });

    it('should NOT reset manual subtitle visibility when extending the right boundary', () => {
      playbackManager = setupManager({
        useMpvSubtitles: true,
        subtitleBehavior: SubtitleBehavior.ForceHide,
        autoPauseAtEnd: true,
        autoPauseAtStart: false
      });

      // Enter clip and manually toggle subs ON
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      expect((playbackManager as any).subtitlesVisible).toBe(false); // ForceHide took effect

      playbackManager.toggleSubtitles();
      expect((playbackManager as any).subtitlesVisible).toBe(true);
      vi.clearAllMocks();

      // Simulate user extending the right boundary
      const modifiedClips = cloneDeep(mockClips);
      modifiedClips[1].endTime = 22;
      modifiedClips[2].startTime = 22;
      playbackManager.updateClips(modifiedClips);

      // Subtitles should REMAIN visible. ForceHide should not re-trigger.
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect((playbackManager as any).subtitlesVisible).toBe(true);
    });

    it('should preserve manual subtitle visibility override when extending the left boundary (ID change)', () => {
      playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.toggleSubtitles();
      vi.clearAllMocks();

      // Simulate user extending the left boundary (Causes clip ID to change because it's based on startTime)
      const modifiedClips = cloneDeep(mockClips);
      modifiedClips[1].startTime = 8;
      modifiedClips[1].id = 'sub-8'; // ID changes!
      modifiedClips[0].endTime = 8;
      playbackManager.updateClips(modifiedClips);

      // The manual override ID should migrate to the new ID silently.
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect((playbackManager as any).subtitlesVisible).toBe(true);
    });
  });

  describe('PlaybackManager: Subtitle Behavior and Settings', () => {

    describe('Behavior at Start of Subtitle', () => {
      it('should apply ForceHide when seeking to a new subtitled clip', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12); // Seek into sub-1
        // Assert anti-flicker hide on seek start
        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledOnce();

        simulateSeekComplete(playbackManager);

        // Assert behavior is applied on seek complete
        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledTimes(2);
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
      });

      it('should apply ForceShow when transitioning naturally to a new subtitled clip', () => {
        playbackManager = setupManager({
          useMpvSubtitles: true,
          subtitleBehavior: SubtitleBehavior.ForceShow,
          autoPauseAtEnd: false
        });
        playbackManager.seek(8); // Start in gap-1
        playbackManager.play();
        vi.clearAllMocks();

        simulateEndOfClip(playbackManager, 10);

        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
      });

      it('should respect the last visibility state when transitioning to a clip with "DoNothing" behavior', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.DoNothing});

        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        playbackManager.toggleSubtitles(); // Manually turn subs OFF
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
        vi.clearAllMocks();

        playbackManager.seek(32); // Seek to new subtitled clip
        simulateSeekComplete(playbackManager);

        // It should hide for anti-flicker, then hide again because the last state was hidden
        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledTimes(2);
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
      });

      it('should NOT apply behavior when seeking within the same clip', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      });

      it('should NOT re-apply behavior when repeating the current clip', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        playbackManager.repeat();
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      });

      it('should have no immediate effect when the setting is changed', () => {
        playbackManager = setupManager({useMpvSubtitles: true});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        const newSettings = {...(playbackManager as any).settings, subtitleBehavior: SubtitleBehavior.ForceHide};
        playbackManager.updateSettings(newSettings);

        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      });

      it('should apply the NEW behavior after a setting change and then a clip transition', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceShow});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        const newSettings = {...(playbackManager as any).settings, subtitleBehavior: SubtitleBehavior.ForceHide};
        playbackManager.updateSettings(newSettings);

        playbackManager.seek(32);
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledTimes(2); // on seek, on apply
      });
    });

    describe('Manual Subtitle Toggle Override', () => {
      it('should allow manual toggle to override ForceHide behavior', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
        vi.clearAllMocks();

        playbackManager.toggleSubtitles(); // User manually toggles ON

        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
      });

      it('should respect the manual override when repeating the same clip', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        playbackManager.toggleSubtitles(); // Manual override ON
        vi.clearAllMocks();

        playbackManager.repeat();
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
      });

      it('should re-apply original behavior when transitioning to a new clip after a manual override', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        playbackManager.toggleSubtitles(); // Manual override ON
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
        vi.clearAllMocks();

        playbackManager.seek(32); // Seek to new clip
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledTimes(2); // Hide on seek, hide on apply behavior
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
      });
    });

    describe('Renderer Switching', () => {
      it('should instantly hide MPV subs when switching to ASS.js renderer', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitlesVisible: true});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        const newSettings = {...(playbackManager as any).settings, useMpvSubtitles: false};
        playbackManager.updateSettings(newSettings);

        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledOnce();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true); // UI should still think they are visible
      });

      it('should keep MPV subs hidden and respect ForceHide for ASS.js renderer', () => {
        playbackManager = setupManager({useMpvSubtitles: false, subtitleBehavior: SubtitleBehavior.ForceHide});
        playbackManager.seek(12); // on sub-1
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledOnce(); // on initial setup
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false); // UI state is correct
        vi.clearAllMocks();

        playbackManager.seek(32); // on sub-15
        simulateSeekComplete(playbackManager);

        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false); // UI state remains correct
      });

      it('should instantly show MPV subs when switching back to MPV renderer if visibility is true', () => {
        playbackManager = setupManager({useMpvSubtitles: false, subtitlesVisible: true});
        playbackManager.seek(12);
        simulateSeekComplete(playbackManager);
        vi.clearAllMocks();

        const newSettings = {...(playbackManager as any).settings, useMpvSubtitles: true};
        playbackManager.updateSettings(newSettings);

        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
      });

      it('should hide MPV subtitles when switching to ASS.js renderer even if user manually toggled subtitles visibility', () => {
        // Start in ASS.js mode
        playbackManager = setupManager({useMpvSubtitles: false, subtitlesVisible: true});

        // Switch to MPV mode
        const mpvSettings = {...(playbackManager as any).settings, useMpvSubtitles: true};
        playbackManager.updateSettings(mpvSettings);

        // Manually toggle subtitles OFF and then back ON
        playbackManager.toggleSubtitles();
        playbackManager.toggleSubtitles();

        expect((playbackManager as any).subtitlesVisible).toBe(true);
        vi.clearAllMocks();

        // Switch back to ASS.js mode
        const assSettings = {...(playbackManager as any).settings, useMpvSubtitles: false};
        playbackManager.updateSettings(assSettings);

        // MPV subtitles must be hidden because player is in ASS.js renderer mode
        expect(mockMpvManager.hideSubtitles).toHaveBeenCalled();
      });

      it('should show MPV subtitles when switching to MPV renderer if subtitles are enabled, even after manual subtitles toggle', () => {
        // Start in ASS.js mode
        playbackManager = setupManager({useMpvSubtitles: false, subtitlesVisible: true});

        // Switch to MPV mode
        let settings = {...(playbackManager as any).settings, useMpvSubtitles: true};
        playbackManager.updateSettings(settings);

        // Hide subtitles manually
        playbackManager.toggleSubtitles();
        expect((playbackManager as any).subtitlesVisible).toBe(false);

        // Switch to ASS.js mode
        settings = {...(playbackManager as any).settings, useMpvSubtitles: false};
        playbackManager.updateSettings(settings);

        // Show subtitles manually
        playbackManager.toggleSubtitles();
        expect((playbackManager as any).subtitlesVisible).toBe(true);

        vi.clearAllMocks();

        // Switch back to MPV mode
        settings = {...(playbackManager as any).settings, useMpvSubtitles: true};
        playbackManager.updateSettings(settings);

        // MPV subtitles should be visible
        expect(mockMpvManager.showSubtitles).toHaveBeenCalled();
      });
    });

    describe('Anti-Flicker on Seek (MPV)', () => {
      it('should hide subtitles immediately on seek, then show them on seek complete', () => {
        playbackManager = setupManager({useMpvSubtitles: true, subtitleBehavior: SubtitleBehavior.ForceShow});
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
        vi.clearAllMocks();

        // Start seeking to a new subtitled clip
        playbackManager.seek(35);

        // Assert: Subtitles are hidden IMMEDIATELY upon starting the seek
        expect(mockMpvManager.hideSubtitles).toHaveBeenCalledOnce();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();

        // Act: The seek operation completes
        simulateSeekComplete(playbackManager);

        // Assert: Subtitles are shown again now that the video frame has updated
        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
      });
    });

    describe('Subtitle Visibility on Clip Transitions', () => {
      it('should keep subtitles enabled when transitioning from a SUBTITLED clip to a GAP', () => {
        // ARRANGE: Start with subs enabled, playing a subtitled clip
        playbackManager = setupManager({subtitlesVisible: true, autoPauseAtEnd: false});
        playbackManager.seek(15); // In sub-1
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
        vi.clearAllMocks();

        // ACT: Let playback cross the boundary into the next gap clip
        simulateEndOfClip(playbackManager, 20);

        // ASSERT: The visibility state should be preserved as true, and no hide command sent
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      });

      it('should keep subtitles disabled when transitioning from a SUBTITLED clip to a GAP', () => {
        // ARRANGE: Start with subs enabled, but then manually disable them on a subtitled clip
        playbackManager = setupManager({subtitlesVisible: true, autoPauseAtEnd: false});
        playbackManager.seek(15); // In sub-1
        simulateSeekComplete(playbackManager);
        playbackManager.toggleSubtitles(); // User turns them OFF
        playbackManager.play();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
        vi.clearAllMocks();

        // ACT: Let playback cross the boundary into the next gap clip
        simulateEndOfClip(playbackManager, 20);

        // ASSERT: The visibility state should be preserved as false
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
        expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
        expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      });

      it('should re-apply ForceShow behavior when transitioning from GAP to SUBTITLED', () => {
        // ARRANGE: Manually hide subtitles while in a gap
        playbackManager = setupManager({
          useMpvSubtitles: true,
          subtitleBehavior: SubtitleBehavior.ForceShow,
          autoPauseAtEnd: false
        });
        playbackManager.seek(5); // in gap-1
        simulateSeekComplete(playbackManager);
        playbackManager.toggleSubtitles(); // User turns them OFF
        playbackManager.play();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
        vi.clearAllMocks();

        // ACT: Transition into the subtitled clip
        simulateEndOfClip(playbackManager, 10);

        // ASSERT: The ForceShow behavior should override the manual setting and show them
        expect(mockMpvManager.showSubtitles).toHaveBeenCalledOnce();
        expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);
      });
    });

    describe('Transitioning State', () => {
      beforeEach(() => {
        playbackManager = setupManager();
      });

      it('enters Transitioning state during seek and resumes correctly if previously playing', () => {
        // Start playing
        playbackManager.play();
        vi.clearAllMocks();

        // Initiate seek
        playbackManager.seek(15, true);

        // Verify immediate transition state
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Transitioning);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);

        // Complete seek
        simulateSeekComplete(playbackManager);

        // Verify resolution
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      });

      it('enters Transitioning state during seek and stays paused if previously paused', () => {
        // Ensure paused
        playbackManager.pause();
        vi.clearAllMocks();

        // Initiate seek
        playbackManager.seek(15);

        // Verify immediate transition state
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Transitioning);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);

        // Complete seek
        simulateSeekComplete(playbackManager);

        // Verify resolution
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
      });

      it('enters Transitioning state during repeat and resumes correctly', () => {
        // Start playing
        playbackManager.play();
        vi.clearAllMocks();

        // Initiate repeat
        playbackManager.repeat();

        // Verify immediate transition state
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Transitioning);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);

        // Complete seek (repeat triggers a seek)
        simulateSeekComplete(playbackManager);

        // Verify resolution
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
      });

      it('enters Transitioning state when moving to next clip (continuous play)', () => {
        // Setup continuous play
        playbackManager = setupManager({autoPauseAtEnd: false});
        playbackManager.seek(5); // In gap-1 (0-10)
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        // Simulate end of current clip manually to check intermediate state.
        // Auto-pause-fired is triggered, which calls playClipAtIndex, which sets state to Transitioning.
        // Manually set current time to end so logic picks it up.
        (playbackManager as any).currentTime = 10;
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // NOW the player should be in Transitioning state waiting for the seek to complete
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Transitioning);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);

        // Complete the seek that was triggered by playClipAtIndex
        simulateSeekComplete(playbackManager);

        // Should be playing next clip
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect((playbackManager as any).currentClipIndex).toBe(1);
      });
    });

    describe('Auto-resume logic on clip jumps', () => {
      it('should automatically play the next clip when jumping from an AutoPausedAtEnd state if autoPauseAtStart flag is false', () => {
        // ARRANGE: Setup "Listening Practice" style
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        });

        // Simulate being auto-paused at the end of subtitled Clip 1 (10s to 20s)
        (playbackManager as any).currentClipIndex = 1;
        (playbackManager as any).currentTime = 20;
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // Verify pre-condition: Player is auto-paused because the clip ended
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
        vi.clearAllMocks();

        // ACT: User performs a NAVIGATION jump to the next subtitled clip
        playbackManager.seek(30, true);
        simulateSeekComplete(playbackManager);

        // ASSERT: Should play immediately
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
      });

      it('should NOT play the next clip if autoPauseAtStart flag is true, even when jumping from an auto-pause', () => {
        // ARRANGE: Setup "Speaking Practice" style
        playbackManager = setupManager({
          autoPauseAtStart: true,
          autoPauseAtEnd: true
        });

        // Auto-pause at end of subtitled Clip 1
        (playbackManager as any).currentClipIndex = 1;
        (playbackManager as any).currentTime = 20;
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // Verify pre-condition: Player is auto-paused because the clip ended
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
        vi.clearAllMocks();

        // ACT: Jump to next subtitled clip (Clip 3 starts at 30s)
        playbackManager.seek(30, true);
        simulateSeekComplete(playbackManager);

        // ASSERT: Stays paused
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtStart);
      });

      it('should stay paused when jumping from an auto-pause into a GAP', () => {
        // ARRANGE
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        });

        // Auto-pause at end of subtitled Clip 1 (10s-20s)
        (playbackManager as any).currentClipIndex = 1;
        (playbackManager as any).currentTime = 20;
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // Verify pre-condition: Player is auto-paused because the clip ended
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
        vi.clearAllMocks();

        // ACT: User clicks into Gap 2 (20s-30s)
        playbackManager.seek(25);
        simulateSeekComplete(playbackManager);

        // ASSERT: Stay paused because the destination is a gap
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
      });

      it('should NOT auto-resume if the player is PausedByUser when a boundary event is received', () => {
        // ARRANGE: Continuous playback (no auto-pauses)
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: false
        });

        // Seek into a clip
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);

        // User manually pauses
        playbackManager.pause();
        expect((playbackManager as any).playerState).toBe(PlayerState.PausedByUser);
        vi.clearAllMocks();

        // Move time to the very end of the clip (simulating a click near edge)
        (playbackManager as any).currentTime = 20;

        // ACT: The Lua script fires the boundary event
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // ASSERT:
        // 1. The manager should have ignored the event (no unpause sent to MPV)
        expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('pause', false);
        // 2. The internal state must remain PausedByUser
        expect((playbackManager as any).playerState).toBe(PlayerState.PausedByUser);
        // 3. No new UI update should have been sent (since nothing changed)
        expect(mockUiWindow.webContents.send).not.toHaveBeenCalled();
      });

      it('should handle continuous playback through Gap -> Sub -> Gap -> Sub without auto-pauses', () => {
        // ARRANGE
        // Timeline: Gap(0-10), Sub A(10-20), Gap(20-30), Sub B(30-40)
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: false,
          gapSpeed: 2.0,
          subtitledClipSpeed: 1.0
        }, 5); // Start in Gap 1 (5s)

        // Start playing
        playbackManager.play();
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        vi.clearAllMocks();

        // TRANSITION 1: Gap 1 -> Sub A (10s)
        (playbackManager as any).currentTime = 10;

        // The Lua script forces a pause BEFORE sending the fired event.
        // This causes the manager to switch to PausedByUser internally.
        simulateMpvEvent(playbackManager, {event: 'property-change', name: 'pause', data: true});

        // Then the Lua script sends the trigger
        const token = (playbackManager as any).currentAutoPauseToken;
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: token});

        // The playback manager enters transitioning state internally
        simulateSeekComplete(playbackManager);

        // ASSERT: Continues to play after transition, without pausing
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(getLastStateUpdate()).toEqual(expect.objectContaining({
          playerState: PlayerState.Playing,
          currentClipIndex: 1
        }));
        vi.clearAllMocks();
      });

      it('should jump to next subtitled clip while playing and honor autoPauseAtStart setting', () => {
        // ARRANGE
        playbackManager = setupManager({
          autoPauseAtStart: true,
          autoPauseAtEnd: false
        }, 5); // Start in Gap 1 (5s)

        // Ensure video is playing
        playbackManager.play();
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        vi.clearAllMocks();

        // ACT: User invokes "Next Subtitled Clip" (or Ctrl+Right) to jump to Clip 1 (starts at 10s)
        playbackManager.seek(10, true);
        simulateSeekComplete(playbackManager);

        // ASSERT:
        // Even though video was playing, the destination has 'autoPauseAtStart: true'.
        // The player should pause and switch to 'AutoPausedAtStart'.
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtStart);
      });

      it('should handle manual seek within same clip while AutoPausedAtEnd and should stay paused', () => {
        // ARRANGE
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        }, 10); // Start at beginning of subtitled clip 1 (10-20)

        // Reach the end of the clip to trigger AutoPause
        (playbackManager as any).currentClipIndex = 1;
        simulateEndOfClip(playbackManager, 20);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
        vi.clearAllMocks();

        // ACT: User manually clicks in the middle of the same clip (e.g. 15s)
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);

        // ASSERT:
        // The video should NOT resume. It should switch to PausedByUser.
        // It should NOT use the "Next Clip" logic (which would resume because autoPauseAtStart is false).
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
      });

      it('should NOT auto-resume during manual click on start of next clip', () => {
        // ARRANGE
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        }, 10);

        // Trigger AutoPause at end of Clip 1
        (playbackManager as any).currentClipIndex = 1;
        simulateEndOfClip(playbackManager, 20);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtEnd);
        vi.clearAllMocks();

        // ACT: User clicks exactly on the start of the next subtitled clip (30s)
        playbackManager.seek(30, false);
        simulateSeekComplete(playbackManager);

        // ASSERT: Should stay PausedByUser because it was a manual click, not a jump to subtitled clip
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
      });

      it('should apply updated autoPauseAtEnd setting when resuming after settings change', () => {
        // ARRANGE
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        });
        playbackManager.seek(15);
        simulateSeekComplete(playbackManager);
        playbackManager.play();
        vi.clearAllMocks();

        // ACT 1: Simulate user opening settings (pauses) -> update -> close (resumes)
        playbackManager.pause();
        const newSettings = {...(playbackManager as any).settings, autoPauseAtEnd: false};
        playbackManager.updateSettings(newSettings);
        playbackManager.play();

        // Clear mocks to focus on the boundary event behavior
        vi.clearAllMocks();

        // ACT 2: Reach end of clip
        simulateEndOfClip(playbackManager, 20);

        // ASSERT: Should NOT stay paused
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(getLastStateUpdate()?.currentClipIndex).toBe(2);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
      });

      it('should preserve PLAYING state after manual timeline click while playing', () => {
        // ARRANGE: Continuous playback (no auto-pauses)
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: false
        }, 5);

        playbackManager.play();
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        vi.clearAllMocks();

        // ACT: User clicks on the timeline (isNavigation = false)
        playbackManager.seek(25, false);
        simulateSeekComplete(playbackManager);

        // ASSERT: Should still be playing
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        expect(getLastStateUpdate()?.currentClipIndex).toBe(2); // In gap-2
      });

      it('should auto-resume if clip settings allow it after navigation shortcut from PAUSED state', () => {
        // ARRANGE: Settings allow immediate play at start, but the player is currently manually paused
        playbackManager = setupManager({
          autoPauseAtStart: false,
          autoPauseAtEnd: true
        }, 5);

        playbackManager.pause();
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
        vi.clearAllMocks();

        // ACT: User hits Ctrl + Right (navigation jump to 10s)
        playbackManager.seek(10, true);
        simulateSeekComplete(playbackManager);

        // ASSERT:
        // It should OVERRIDE the manual pause because isNavigation is true
        // and the destination settings allow immediate playback.
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', false);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
        expect(getLastStateUpdate()?.currentClipIndex).toBe(1);
      });

      it('should stay paused if autoPauseAtStart is true after navigation shortcut from PAUSED state', () => {
        // ARRANGE: Settings require pause at start
        playbackManager = setupManager({
          autoPauseAtStart: true,
          autoPauseAtEnd: true
        }, 5);

        playbackManager.pause();
        vi.clearAllMocks();

        // ACT: User hits Ctrl + Right
        playbackManager.seek(10, true);
        simulateSeekComplete(playbackManager);

        // ASSERT: Respected the setting and stayed paused
        expect(mockMpvManager.setProperty).toHaveBeenCalledWith('pause', true);
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.AutoPausedAtStart);
      });

      it('should ignore stale auto-pause events if user has already initiated navigation to next clip', () => {
        // ARRANGE: Listening Practice (Pause at End = true, Start = false)
        // sub-1 is 10-20. sub-15 is 30-40.
        playbackManager = setupManager({
          autoPauseAtEnd: true,
          autoPauseAtStart: false
        }, 15); // Playing in sub-1

        playbackManager.play();
        vi.clearAllMocks();

        // ACT 1: User navigates to next subtitled clip (sub-15 starts at 30)
        // This sets state to Transitioning and updates index to the new clip.
        // This ALSO generates a NEW token internally in playbackManager.
        playbackManager.seek(30, true);

        expect((playbackManager as any).playerState).toBe(PlayerState.Transitioning);

        // ACT 2: Simulate delayed 'auto-pause-fired' event arriving from Lua
        // Pass a DUMMY token to represent the OLD token from the previous clip.
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: 'old-stale-token'});

        // ASSERT:
        // The event should be ignored. State should NOT flip to AutoPausedAtEnd.
        // It should remain Transitioning until the seek completes.
        const lastUpdate = getLastStateUpdate();
        expect(lastUpdate?.playerState).toBe(PlayerState.Transitioning);
        expect(lastUpdate?.playerState).not.toBe(PlayerState.AutoPausedAtEnd);
      });

      it('should ignore stale auto-pause events even after transition to new clip is complete (Playing state)', () => {
        // ARRANGE: Listening Practice
        playbackManager = setupManager({autoPauseAtEnd: true});
        playbackManager.play();

        // ACT 1: Jump to next subtitled clip
        playbackManager.seek(35, true);
        simulateSeekComplete(playbackManager);

        // Now state is Playing inside the new clip.
        expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);

        // Clear mocks to isolate the next step
        vi.clearAllMocks();

        // ACT 2: Simulate stale 'auto-pause-fired' event arriving from the PREVIOUS clip.
        simulateMpvEvent(playbackManager, {event: 'auto-pause-fired', data: 'STALE_TOKEN_ID'});

        // ASSERT:
        // Should NOT pause
        expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('pause', true);

        // Should NOT snap time back
        expect(mockMpvManager.sendCommand).not.toHaveBeenCalledWith(expect.arrayContaining(['seek']));

        // State should remain Playing (check internal state directly since no new update was emitted)
        expect((playbackManager as any).playerState).toBe(PlayerState.Playing);
      });
    });
  });

  describe('Skip Gaps Feature', () => {
    const baseSettings = {
      subtitledClipSpeed: 1.0,
      gapSpeed: 2.0,
      skipGaps: true,
      autoPauseAtStart: false,
      autoPauseAtEnd: false
    };

    it('should jump directly to the next subtitled clip when a clip ends', () => {
      playbackManager = setupManager(baseSettings);
      playbackManager.seek(15); // in sub-1 (index 1)
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      vi.clearAllMocks();

      simulateEndOfClip(playbackManager, 20); // end of sub-1

      // Should skip gap-2 (index 2) and jump to sub-15 (index 3)
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 30, 'absolute']);
      expect(getLastStateUpdate()).toEqual(expect.objectContaining({
        currentClipIndex: 3,
        playerState: PlayerState.Playing
      }));
    });

    it('should remain glued to the end of the last subtitle and NOT enter Ended state if a trailing gap remains', () => {
      // ARRANGE: A layout where a subtitled clip is followed by a trailing gap (e.g., credits)
      const clipsWithTrailingGap: LightweightVideoClip[] = [
        {id: 'sub-last', startTime: 0, endTime: 10, hasSubtitle: true},
        {id: 'gap-credits', startTime: 10, endTime: 100, hasSubtitle: false}
      ];

      // Settings: Skip Gaps is ON, but Auto-Pause is OFF (Continuous play)
      const settings = {
        ...DEFAULT_PROJECT_SETTINGS,
        skipGaps: true,
        autoPauseAtEnd: false
      };

      const manager = new PlaybackManager(
        mockMpvManager as unknown as MpvManager,
        mockUiWindow as unknown as BrowserWindow
      );

      // Load at 5s (midway through the last subtitle)
      manager.loadProject(clipsWithTrailingGap, settings, 5, {enabled: false, speed: 1.0});
      manager.play();
      vi.clearAllMocks();

      // ACT: Simulate the last subtitled clip ending at 10s
      (manager as any).currentClipIndex = 0;
      const token = (manager as any).currentAutoPauseToken;
      (manager as any).handleMpvEvent({event: 'auto-pause-fired', data: token});

      // ASSERT:
      // The player should NOT seek (seeking to the end or into the gap is wrong)
      expect(mockMpvManager.sendCommand).not.toHaveBeenCalledWith(expect.arrayContaining(['seek']));

      // The player should NOT be in Ended state (because the video file itself hasn't ended)
      expect((manager as any).playerState).not.toBe(PlayerState.Ended);

      // The player should be AutoPausedAtEnd (staying at the 10s mark)
      expect((manager as any).playerState).toBe(PlayerState.AutoPausedAtEnd);

      // Verify UI was notified of the specific pause state
      const lastUpdate = getLastStateUpdate();
      expect(lastUpdate?.playerState).toBe(PlayerState.AutoPausedAtEnd);
      expect(lastUpdate?.currentTime).toBeCloseTo(9.99); // Snapped to end
    });

    it('should correctly jump to next subtitled clip when resuming from AutoPausedAtEnd', () => {
      playbackManager = setupManager({...baseSettings, autoPauseAtEnd: true});
      (playbackManager as any).currentClipIndex = 1; // sub-1
      simulateEndOfClip(playbackManager, 20);
      vi.clearAllMocks();

      playbackManager.play();

      // Should skip gap-2 (index 2) and play sub-15 (index 3)
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 30, 'absolute']);
      expect((playbackManager as any).currentClipIndex).toBe(3);
    });
  });

  describe('Speed Override Feature', () => {
    beforeEach(() => {
      playbackManager = setupManager({
        gapSpeed: 2.0,
        subtitledClipSpeed: 1.0,
        speedOverride: 0.5
      });
    });

    it('should apply override speed immediately when enabled while playing', () => {
      playbackManager.seek(15); // Start in subtitled clip (Normal speed 1.0)
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      vi.clearAllMocks();

      // Enable override
      playbackManager.setSpeedOverride(true);

      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);
    });

    it('should revert to context-aware speed when disabled', () => {
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      // Toggle On -> Off
      playbackManager.setSpeedOverride(true);
      vi.clearAllMocks();

      playbackManager.setSpeedOverride(false);

      // Should revert to subtitled speed (1.0)
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.0);
    });

    it('should revert to GAP speed if disabled while in a gap', () => {
      playbackManager.seek(5); // Start in gap (Normal speed 2.0)
      simulateSeekComplete(playbackManager);

      playbackManager.setSpeedOverride(true); // Speed -> 0.5
      vi.clearAllMocks();

      playbackManager.setSpeedOverride(false);

      // Should revert to gap speed (2.0)
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 2.0);
    });

    it('should maintain override speed when transitioning between clips', () => {
      // Start in Gap (0-10) with override ENABLED
      playbackManager.seek(5);
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      playbackManager.setSpeedOverride(true);
      vi.clearAllMocks();

      // Transition Gap -> Subtitle (at 10s)
      simulateEndOfClip(playbackManager, 10);

      // The manager reapplies settings on transition.
      // It should NOT switch to 1.0 (sub speed), it should stay 0.5 (override).
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);
      expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('speed', 1.0);
    });

    it('should NOT resume playback if paused when speed override is toggled', () => {
      // ARRANGE: Seek to a clip and ensure it is paused
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.pause();

      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.PausedByUser);
      vi.clearAllMocks();

      // ACT: Enable Speed Override while paused
      playbackManager.setSpeedOverride(true);

      // ASSERT:
      // 1. Speed should be updated
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);

      // 2. Pause property should NOT be changed to false
      expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('pause', false);

      // 3. State should remain PausedByUser
      const lastUpdate = getLastStateUpdate();
      if (lastUpdate) {
        expect(lastUpdate.playerState).toBe(PlayerState.PausedByUser);
      }
    });

    it('should maintain override speed after seeking', () => {
      // ARRANGE
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      // Enable override (Speed -> 0.5)
      playbackManager.setSpeedOverride(true);
      vi.clearAllMocks();

      // ACT: Seek to a different clip (e.g. gap at 5s, which would normally be 2.0x)
      playbackManager.seek(5);

      // ASSERT: Speed should be set to override (0.5), NOT gap speed (2.0)
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);
    });
  });

  describe('Speed Override & Subtitle Visibility Interaction', () => {
    beforeEach(() => {
      playbackManager = setupManager({
        subtitlesVisible: true,
        useMpvSubtitles: true, // Use MPV subs to test hideSubtitles/showSubtitles calls
        subtitledClipSpeed: 1.0,
        speedOverride: 0.5
      });
    });

    it('should NOT toggle subtitle visibility when enabling speed override', () => {
      // Start in a subtitled clip with subtitles visible
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      expect(mockMpvManager.showSubtitles).toHaveBeenCalled();
      vi.clearAllMocks();

      // Enable Speed Override
      playbackManager.setSpeedOverride(true);

      // Should apply speed...
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);

      // ...but should NOT call hideSubtitles or showSubtitles again unnecessarily
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
    });

    it('should respect ForceHide behavior even when speed override is active', () => {
      playbackManager = setupManager({
        useMpvSubtitles: true,
        subtitleBehavior: SubtitleBehavior.ForceHide,
        subtitlesVisible: true,
        speedOverride: 0.5
      });

      // Seek to subtitled clip
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      // ForceHide should have hidden them
      expect(mockMpvManager.hideSubtitles).toHaveBeenCalled();
      vi.clearAllMocks();

      // Enable Speed Override
      playbackManager.setSpeedOverride(true);

      // Should still be hidden
      expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);
    });

    it('should allow toggling subtitles manually while override is active', () => {
      playbackManager = setupManager({
        subtitlesVisible: false,
        useMpvSubtitles: true
      });

      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      // Enable override
      playbackManager.setSpeedOverride(true);

      // User toggles subs ON while slowed down
      playbackManager.toggleSubtitles();

      expect(mockMpvManager.showSubtitles).toHaveBeenCalled();

      // Clear mocks so previous calls don't trigger the next assertion
      vi.clearAllMocks();

      // Disable override
      playbackManager.setSpeedOverride(false);

      // Subs should stay ON
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
    });
  });

  describe('Cinema Mode', () => {
    it('should force global Cinema Mode speed, ignoring subtitled and gap speeds', () => {
      playbackManager = setupManager({subtitledClipSpeed: 1.0, gapSpeed: 2.5});
      playbackManager.setCinemaMode({enabled: true, speed: 1.5});

      // Check gap speed
      playbackManager.seek(5);
      simulateSeekComplete(playbackManager);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.5);

      // Check subtitled clip speed
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.5);
    });

    it('should still allow Shift key (Speed Override) to bypass Cinema Mode speed', () => {
      playbackManager = setupManager({speedOverride: 0.5});
      playbackManager.setCinemaMode({enabled: true, speed: 1.5});

      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);

      playbackManager.setSpeedOverride(true);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 0.5);

      playbackManager.setSpeedOverride(false);
      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 1.5);
    });

    it('should disable Lua auto-pauses entirely', () => {
      playbackManager = setupManager({autoPauseAtEnd: true});
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      vi.clearAllMocks();

      playbackManager.setCinemaMode({enabled: true, speed: 1.0});

      // Should explicitly disable the Lua hook
      expect(mockMpvManager.setLuaAutoPause).toHaveBeenCalledWith(-1, '');
    });

    it('should ignore autoPauseAtStart and play continuously across boundaries', () => {
      playbackManager = setupManager({autoPauseAtStart: true});
      playbackManager.setCinemaMode({enabled: true, speed: 1.0});
      playbackManager.play();
      vi.clearAllMocks();

      // Start in gap (0-10), hit end of gap (10s), crossing into a subtitled clip
      (playbackManager as any).currentClipIndex = 0;
      (playbackManager as any).currentTime = 10;

      // Simulate normal boundary crossing (no Lua auto-pause token since it's disabled)
      playbackManager.updateClips(cloneDeep(mockClips));

      expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('pause', true);
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
      expect((playbackManager as any).currentClipIndex).toBe(1); // Successfully moved to sub-1
    });

    it('should ignore skipGaps and play through them normally', () => {
      playbackManager = setupManager({skipGaps: true});
      playbackManager.setCinemaMode({enabled: true, speed: 1.0});
      playbackManager.seek(15); // Start in sub-1
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      vi.clearAllMocks();

      // Hit boundary of sub-1 (20s). Normally, skipGaps would jump to 30s.
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 20;
      playbackManager.updateClips(cloneDeep(mockClips));

      // Should NOT send a seek command. Should just roll into gap-2 at index 2.
      expect(mockMpvManager.sendCommand).not.toHaveBeenCalledWith(expect.arrayContaining(['seek']));
      expect((playbackManager as any).currentClipIndex).toBe(2);
    });

    it('should ignore SubtitleBehavior (ForceHide/ForceShow) and preserve current visibility state', () => {
      playbackManager = setupManager({
        useMpvSubtitles: true,
        subtitlesVisible: true,
        subtitleBehavior: SubtitleBehavior.ForceHide
      });
      playbackManager.setCinemaMode({enabled: true, speed: 1.0});

      playbackManager.seek(15); // Seek into subtitled clip
      vi.clearAllMocks(); // Clear the anti-flicker 'hideSubtitles' call from the initial seek

      simulateSeekComplete(playbackManager);

      // ForceHide should be ignored; subtitles should NOT be hidden again
      expect(mockMpvManager.hideSubtitles).not.toHaveBeenCalled();
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(true);

      // Even if user manually toggles them OFF, a transition shouldn't force them back
      playbackManager.toggleSubtitles();
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
      vi.clearAllMocks();

      // Transition to next clip
      (playbackManager as any).currentClipIndex = 1;
      (playbackManager as any).currentTime = 20;
      playbackManager.updateClips(cloneDeep(mockClips));

      expect(mockMpvManager.showSubtitles).not.toHaveBeenCalled();
      expect(getLastStateUpdate()?.subtitlesVisible).toBe(false);
    });

    it('should flush MPV audio buffer when speed is changed via settings while paused in Cinema Mode', () => {
      playbackManager = setupManager();
      playbackManager.seek(15);
      simulateSeekComplete(playbackManager);
      playbackManager.pause();

      playbackManager.setCinemaMode({enabled: true, speed: 1.5});
      vi.clearAllMocks();

      // Update speed while already in cinema mode
      playbackManager.setCinemaMode({enabled: true, speed: 2.0});

      expect(mockMpvManager.setProperty).toHaveBeenCalledWith('speed', 2.0);
      expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 15, 'absolute', 'exact']);
    });

    it('should naturally advance currentClipIndex during continuous playback based on time-pos updates', () => {
      playbackManager = setupManager();
      playbackManager.setCinemaMode({enabled: true, speed: 1.0});

      playbackManager.seek(8); // Start in gap-1 (0s to 10s)
      simulateSeekComplete(playbackManager);
      playbackManager.play();
      vi.clearAllMocks();

      expect((playbackManager as any).currentClipIndex).toBe(0);

      // Simulate MPV ticking forward, still inside gap-1
      simulateMpvEvent(playbackManager, {event: 'property-change', name: 'time-pos', data: 9.5});
      expect((playbackManager as any).currentClipIndex).toBe(0); // Still 0

      // Simulate MPV ticking across the boundary into sub-1 (10s to 20s)
      simulateMpvEvent(playbackManager, {event: 'property-change', name: 'time-pos', data: 10.2});

      // Index should have automatically updated without needing Lua's auto-pause token
      expect((playbackManager as any).currentClipIndex).toBe(1);
      expect(getLastStateUpdate()?.currentClipIndex).toBe(1);
    });

    it('should ignore autoPauseAtStart setting when navigating to a new clip via shortcut in Cinema Mode', () => {
      // ARRANGE: Settings require pause at start, but Cinema Mode is ON
      playbackManager = setupManager({autoPauseAtStart: true});
      playbackManager.setCinemaMode({enabled: true, speed: 1.0});

      // Seek to a new clip (index 3) using navigation (isNavigation = true)
      // This bypasses normal playhead ticking and goes straight to the navigation logic
      playbackManager.seek(30, true);
      simulateSeekComplete(playbackManager);

      // ASSERT:
      // Even though autoPauseAtStart is true, Cinema Mode should force playback to continue.
      expect(mockMpvManager.setProperty).not.toHaveBeenCalledWith('pause', true);
      expect(getLastStateUpdate()?.playerState).toBe(PlayerState.Playing);
      expect((playbackManager as any).currentClipIndex).toBe(3);
    });
  });
});
