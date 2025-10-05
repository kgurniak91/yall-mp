import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PlaybackManager, PlaybackStateUpdate} from '../playback-manager';
import {PlayerState, VideoClip} from '../src/app/model/video.types';
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
  {
    id: 'sub-15',
    startTime: 30,
    endTime: 40,
    hasSubtitle: true,
    duration: 10,
    parts: [],
    sourceSubtitles: [{id: 's2', type: 'srt', text: 'B', startTime: 30, endTime: 40}]
  }
] as VideoClip[];

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

  const setupManager = (settings: Partial<ProjectSettings> = {}) => {
    const fullSettings = {...DEFAULT_PROJECT_SETTINGS, ...settings};
    const manager = new PlaybackManager(mockMpvManager as unknown as MpvManager, mockUiWindow as unknown as BrowserWindow);
    manager.loadProject(cloneDeep(mockClips), fullSettings);
    return manager;
  };

  const simulateMpvEvent = (manager: PlaybackManager, event: any) => (manager as any).handleMpvEvent(event);
  const simulateSeekComplete = (manager: PlaybackManager) => simulateMpvEvent(manager, {event: 'seek'});
  const simulateEndOfClip = (manager: PlaybackManager, time: number) => {
    (manager as any).currentTime = time - 0.05;
    (manager as any).handleClipEnd();
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
  });

  describe('User Action: Playback Start', () => {
    it('should apply correct settings for the first clip when starting playback from idle', () => {
      // ARRANGE: Setup with a fast gap speed. The first clip is a gap.
      playbackManager = setupManager({gapSpeed: 3.0, subtitledClipSpeed: 1.0});

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
        expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 20, 'absolute+exact']);
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
        expect(mockMpvManager.sendCommand).toHaveBeenCalledWith(['seek', 20, 'absolute+exact']);
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
      playbackManager = setupManager();
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
  });
});
