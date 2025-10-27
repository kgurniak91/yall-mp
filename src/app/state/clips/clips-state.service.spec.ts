import {fakeAsync, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {MockBuilder} from 'ng-mocks';
import {AssSubtitleData, SrtSubtitleData} from '../../../../shared/types/subtitle.type';
import {VideoClip} from '../../model/video.types';
import {ADJUST_DEBOUNCE_MS, ClipsStateService, MIN_GAP_DURATION, MIN_SUBTITLE_DURATION} from './clips-state.service';
import {VideoStateService} from '../video/video-state.service';
import {CommandHistoryStateService} from '../command-history/command-history-state.service';
import {AppStateService} from '../app/app-state.service';
import {ToastService} from '../../shared/services/toast/toast.service';
import {AssEditService} from '../../features/project-details/services/ass-edit/ass-edit.service';
import {GlobalSettingsStateService} from '../global-settings/global-settings-state.service';
import {MOCK_VIDEO_DURATION, TEST_CASES, TestCase} from '../../../../test/test-cases';
import {createServiceFactory, SpectatorService} from '@ngneat/spectator';
import {CreateSubtitledClipCommand} from '../../model/commands/create-subtitled-clip.command';
import {DeleteSubtitledClipCommand} from '../../model/commands/delete-subtitled-clip.command';
import {MergeSubtitledClipsCommand} from '../../model/commands/merge-subtitled-clips.command';
import {SplitSubtitledClipCommand} from '../../model/commands/split-subtitled-clip.command';
import {cloneDeep} from 'lodash-es';

describe('ClipsStateService', () => {
  const currentTimeSignal = signal(0);

  const dependencies = MockBuilder(ClipsStateService)
    .mock(VideoStateService, {
      duration: signal(MOCK_VIDEO_DURATION),
      currentTime: currentTimeSignal.asReadonly(),
      setCurrentTime: (time: number) => currentTimeSignal.set(time)
    })
    .mock(GlobalSettingsStateService, {
      boundaryAdjustAmountMs: signal(50),
    })
    .mock(AppStateService)
    .mock(ToastService)
    .provide(AssEditService)
    .provide(CommandHistoryStateService)
    .build();

  const createService = createServiceFactory({
    service: ClipsStateService,
    ...dependencies
  });

  let spectator: SpectatorService<ClipsStateService>;
  let service: ClipsStateService;
  let appStateService: AppStateService;
  let commandHistoryService: CommandHistoryStateService;
  let projectState: any;
  let videoStateService: VideoStateService;
  let toastService: ToastService;

  beforeEach(() => {
    (window as any).electronAPI = {
      onPlaybackStateUpdate: jasmine.createSpy('onPlaybackStateUpdateSpy'),
      playbackUpdateClips: jasmine.createSpy('playbackUpdateClipsSpy')
    };
    spectator = createService();
    service = spectator.inject(ClipsStateService);
    appStateService = spectator.inject(AppStateService);
    commandHistoryService = spectator.inject(CommandHistoryStateService);
    videoStateService = spectator.inject(VideoStateService);
    toastService = spectator.inject(ToastService);
    commandHistoryService.clearHistory();

    projectState = {id: 'proj-1', subtitles: []};
    (appStateService.getProjectById as jasmine.Spy).and.callFake(() => projectState);
    (appStateService.updateProject as jasmine.Spy).and.callFake((id, updates) => {
      if (id === 'proj-1') {
        projectState = {...projectState, ...updates};
        if (updates.subtitles) {
          service.setSubtitles(updates.subtitles);
        }
      }
    });
    service.setProjectId('proj-1');
  });

  describe('Clip Generation', () => {
    TEST_CASES.forEach((testCase: TestCase) => {
      it(`generates correct VideoClips for test case: "${testCase.description}"`, () => {
        service.setSubtitles(testCase.expectedSubtitleData);
        const actualClips = service.clips();

        const simplifiedActual = actualClips.map(clip => ({
          id: clip.id, startTime: clip.startTime, endTime: clip.endTime, hasSubtitle: clip.hasSubtitle,
          parts: [...clip.parts].sort((a, b) => a.style.localeCompare(b.style) || a.text.localeCompare(b.text))
        }));

        const simplifiedExpected = testCase.expectedVideoClips.map(clip => ({
          ...clip,
          parts: [...(clip.parts || [])].sort((a, b) => a.style.localeCompare(b.style) || a.text.localeCompare(b.text))
        }));

        expect(simplifiedActual).toEqual(simplifiedExpected as any);
      });
    });
  });

  describe('updateClipText', () => {
    it('updates all underlying SubtitleData objects when a merged ASS clip is edited', () => {
      projectState.rawAssContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,Real Usable',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,English Lesson',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,Real Usable',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,English Lesson',
      ].join('\r\n');
      projectState.subtitles = [
        {
          type: 'ass',
          id: 'uuid-1',
          startTime: 59.53,
          endTime: 59.58,
          parts: [{text: 'Real Usable', style: 'Sign-Default'}]
        },
        {
          type: 'ass',
          id: 'uuid-2',
          startTime: 59.53,
          endTime: 59.58,
          parts: [{text: 'English Lesson', style: 'Sign-Default'}]
        },
        {
          type: 'ass',
          id: 'uuid-3',
          startTime: 59.58,
          endTime: 59.62,
          parts: [{text: 'Real Usable', style: 'Sign-Default'}]
        },
        {
          type: 'ass',
          id: 'uuid-4',
          startTime: 59.58,
          endTime: 59.62,
          parts: [{text: 'English Lesson', style: 'Sign-Default'}]
        },
      ];
      service.setSubtitles(projectState.subtitles);

      const clipBeforeEdit: VideoClip = service.clips().find(c => c.hasSubtitle)!;
      const newContent = {
        parts: [
          {text: 'Real Usable EDITED', style: 'Sign-Default'},
          {text: 'English Lesson', style: 'Sign-Default'}
        ]
      };

      service.updateClipText('proj-1', clipBeforeEdit, newContent);

      const expectedNewRawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,Real Usable EDITED',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,English Lesson',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,Real Usable EDITED',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,English Lesson',
      ].join('\r\n');

      expect(appStateService.updateProject).toHaveBeenCalledOnceWith('proj-1', {
        subtitles: jasmine.any(Array),
        rawAssContent: expectedNewRawContent
      });
    });

    it('updates the text for a simple SRT clip', () => {
      const initialSrtSubtitle: SrtSubtitleData[] = [{
        type: 'srt',
        id: 'srt-uuid-1',
        startTime: 10,
        endTime: 12,
        text: 'Old text'
      }];
      service.setSubtitles(initialSrtSubtitle);
      const srtClipBeforeEdit: VideoClip = service.clips().find(c => c.hasSubtitle)!;
      const newSrtContent = {text: 'New SRT text'};
      service.updateClipText('proj-1', srtClipBeforeEdit, newSrtContent);

      const finalClip = service.clips().find(c => c.hasSubtitle)!;
      const finalSubtitles = finalClip.sourceSubtitles as SrtSubtitleData[];
      expect(finalSubtitles[0].text).toBe('New SRT text');
    });
  });

  describe('Clip Timing Adjustments (SRT)', () => {
    const initialSrtSubtitles: SrtSubtitleData[] = [
      {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'Subtitle A'},
      {type: 'srt', id: 'srt-2', startTime: 15, endTime: 20, text: 'Subtitle B'}
    ];

    beforeEach(() => {
      projectState.subtitles = JSON.parse(JSON.stringify(initialSrtSubtitles));
      service.setSubtitles(JSON.parse(JSON.stringify(initialSrtSubtitles)));
    });

    it('expands a subtitle clip into an adjacent gap', () => {
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 12);

      const clips = service.clips();
      const updatedClip = clips[1];
      const adjacentGap = clips[2];

      expect(updatedClip.endTime).toBe(12);
      expect(adjacentGap.startTime).toBe(12);
    });

    it('shrinks a subtitle clip, expanding the adjacent gap', () => {
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 8);

      const clips = service.clips();
      const updatedClip = clips[1];
      const adjacentGap = clips[2];

      expect(updatedClip.endTime).toBe(8);
      expect(adjacentGap.startTime).toBe(8);
    });

    it('expands a gap, shrinking the adjacent subtitle clip', () => {
      const gapClip = service.clips().find(c => c.id === 'gap-0')!;
      service.updateClipTimesFromTimeline(gapClip.id, 0, 7);

      const clips = service.clips();
      const updatedGap = clips[0];
      const adjacentSubtitle = clips[1];

      expect(updatedGap.endTime).toBe(7);
      expect(adjacentSubtitle.startTime).toBe(7);
    });

    it('shrinks a gap, expanding the adjacent subtitle clip', () => {
      const gapClip = service.clips().find(c => c.id === 'gap-10')!;
      service.updateClipTimesFromTimeline(gapClip.id, 12, 15);

      const clips = service.clips();
      const updatedGap = clips[2];
      const precedingSubtitle = clips[1];

      expect(updatedGap.startTime).toBe(12);
      expect(precedingSubtitle.endTime).toBe(12);
    });

    it('correctly undoes and redoes a clip adjustment', () => {
      const initialClipsState = JSON.stringify(service.clips());
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 12);
      const modifiedClipsState = JSON.stringify(service.clips());

      expect(initialClipsState).not.toEqual(modifiedClipsState);

      commandHistoryService.undo();
      expect(JSON.stringify(service.clips())).toEqual(initialClipsState);

      commandHistoryService.redo();
      expect(JSON.stringify(service.clips())).toEqual(modifiedClipsState);
    });

    it('adjusts boundary with keyboard shortcut and correctly undoes it', fakeAsync(() => {
      const initialClipsState = JSON.stringify(service.clips());
      service.setCurrentClipByIndex(1); // Select 'Subtitle A'
      service.adjustCurrentClipBoundary('end', 'right');
      tick(100); // Allow debounce timer in performAdjust to complete

      const modifiedClip = service.clips()[1];
      expect(modifiedClip.endTime).toBe(10.05);

      commandHistoryService.undo();
      expect(JSON.stringify(service.clips())).toEqual(initialClipsState);
    }));

    it('creates a gap when shrinking a subtitle clip adjacent to another subtitle clip', () => {
      // ARRANGE: Two adjacent subtitle clips
      const adjacentSubtitles: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'A'},
        {type: 'srt', id: 'srt-2', startTime: 10, endTime: 15, text: 'B'}
      ];
      service.setSubtitles(adjacentSubtitles);
      // Clips are: gap, sub A, sub B, gap -> 4 clips
      expect(service.clips().length).withContext('Pre-condition: Should have 4 clips').toBe(4);

      const firstSub = service.clips()[1];

      // ACT: Shrink the first clip by moving its end handle to the left
      service.updateClipTimesFromTimeline(firstSub.id, 5, 8);

      // ASSERT: A gap should have been created between the two subtitle clips
      const clips = service.clips();
      expect(clips.length).withContext('Should now have 5 clips').toBe(5); // gap, sub, NEW GAP, sub, gap
      expect(clips[1].endTime).toBe(8); // First clip shrinks
      expect(clips[2].hasSubtitle).toBe(false); // New clip is a gap
      expect(clips[2].startTime).toBe(8);
      expect(clips[2].endTime).toBe(10);
      expect(clips[3].startTime).toBe(10); // Second clip is untouched
      expect(clips[3].endTime).toBe(15);
    });

    it('consumes an adjacent subtitled clip when stretching over it', () => {
      // ARRANGE: Set up a state with two perfectly adjacent subtitle clips.
      const adjacentSubtitles: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'Subtitle A'},
        {type: 'srt', id: 'srt-2', startTime: 10, endTime: 15, text: 'Subtitle B'}
      ];
      service.setSubtitles(adjacentSubtitles);

      let clips = service.clips();
      // Clips are: [gap(0-5), sub(5-10), sub(10-15), gap(15-end)]
      expect(clips.length).withContext('Should have 4 clips initially').toBe(4);
      const firstSub = clips[1];

      // ACT: Try to stretch the first subtitle clip 2 seconds INTO the second one
      service.updateClipTimesFromTimeline(firstSub.id, 5, 12);

      // ASSERT: The second clip should be shrunk.
      clips = service.clips();
      const modifiedFirstSub = clips[1];
      const modifiedSecondSub = clips[2];

      expect(modifiedFirstSub.endTime).withContext('End time of first clip should be 12s').toBe(12);
      expect(modifiedSecondSub.startTime).withContext('Start time of second clip should be 12s').toBe(12);
      expect(modifiedSecondSub.endTime).withContext('End time of second clip should remain 15s').toBe(15);
    });

    it('consumes a gap and shrinks the next subtitled clip when stretching over it', () => {
      // ARRANGE: Clip A (5-10), Gap (10-15), Clip B (15-20)
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'A'},
        {type: 'srt', id: 'srt-2', startTime: 15, endTime: 20, text: 'B'}
      ];
      service.setSubtitles(initialSubs);
      let clips = service.clips();
      // gap(0-5), sub A(5-10), gap(10-15), sub B(15-20), gap(20-end)
      expect(clips.length).withContext('Pre-condition: Should have 5 clips').toBe(5);
      const clipA = clips[1];

      // ACT: Drag right edge of Clip A past Clip B, trying to consume it almost entirely (19.95).
      service.updateClipTimesFromTimeline(clipA.id, 5, 19.95);

      // ASSERT
      clips = service.clips();
      const updatedClipA = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-1'))!;
      const updatedClipB = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-2'))!;

      const expectedClipBStartTime = 20 - MIN_SUBTITLE_DURATION;

      expect(clips.filter(c => c.hasSubtitle).length).withContext('Should still have 2 subtitled clips').toBe(2);
      expect(clips.length).withContext('Should have 4 clips (gap consumed)').toBe(4);

      expect(updatedClipA.endTime).toBeCloseTo(expectedClipBStartTime);
      expect(updatedClipB.startTime).toBeCloseTo(expectedClipBStartTime);
      expect(updatedClipB.endTime).toBe(20);
    });

    it('consumes a gap and shrinks the previous subtitled clip when stretching over it', () => {
      // ARRANGE: Clip A (5-10), Gap (10-15), Clip B (15-20)
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'A'},
        {type: 'srt', id: 'srt-2', startTime: 15, endTime: 20, text: 'B'}
      ];
      service.setSubtitles(initialSubs);
      let clips = service.clips();
      expect(clips.length).withContext('Pre-condition: Should have 5 clips').toBe(5);
      const clipB = clips[3];

      // ACT: Drag left edge of Clip B to where Clip A starts, consuming it almost entirely (5.05s).
      service.updateClipTimesFromTimeline(clipB.id, 5.05, 20);

      // ASSERT
      clips = service.clips();
      const updatedClipA = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-1'))!;
      const updatedClipB = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-2'))!;

      const expectedClipAEndTime = 5 + MIN_SUBTITLE_DURATION;

      expect(clips.filter(c => c.hasSubtitle).length).withContext('Should still have 2 subtitled clips').toBe(2);
      expect(clips.length).withContext('Should have 4 clips (gap consumed)').toBe(4);

      expect(updatedClipA.endTime).toBeCloseTo(expectedClipAEndTime);
      expect(updatedClipB.startTime).toBeCloseTo(expectedClipAEndTime);
      expect(updatedClipA.startTime).toBe(5);
    });

    it('prevents a clip from inverting its start/end times', () => {
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;

      // ACT 1: Try to move end time past start time
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 4);

      let clips = service.clips();
      let modifiedClip = clips[1];
      // A subtitled clip's min duration is 0.5s
      expect(modifiedClip.endTime).toBeCloseTo(modifiedClip.startTime + 0.5);

      // ACT 2: Try to move start time past end time
      service.updateClipTimesFromTimeline(subtitleClip.id, 11, 10);

      clips = service.clips();
      modifiedClip = clips[1];
      // A subtitled clip's min duration is 0.5s
      expect(modifiedClip.startTime).toBeCloseTo(modifiedClip.endTime - 0.5);
    });

    it('preserves a large gap when a clip is resized slightly into it', () => {
      // ARRANGE: Clip A (5-10), Huge Gap (10-50), Clip B (50-55)
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'A'},
        {type: 'srt', id: 'srt-2', startTime: 50, endTime: 55, text: 'B'}
      ];
      service.setSubtitles(initialSubs);
      let clips = service.clips();
      // gap(0-5), sub A(5-10), gap(10-50), sub B(50-55), gap(55-end)
      expect(clips.length).withContext('Pre-condition: Should have 5 clips').toBe(5);
      const clipA = clips[1];

      // ACT: Drag right edge of Clip A slightly into the gap
      service.updateClipTimesFromTimeline(clipA.id, 5, 12);

      // ASSERT
      clips = service.clips();
      const updatedClipA = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-1'))!;
      const updatedClipB = clips.find(c => c.sourceSubtitles.some(s => s.id === 'srt-2'))!;
      const gap = clips[2];

      expect(clips.length).withContext('Should still have 5 clips').toBe(5);
      expect(updatedClipA.endTime).toBe(12);
      expect(gap.startTime).toBe(12);
      expect(gap.endTime).toBe(50); // Gap should be smaller, but still exist
      expect(updatedClipB.startTime).toBe(50); // Clip B should be untouched
      expect(updatedClipB.endTime).toBe(55);
    });

    it('doesn\'t shrink a subtitled clip below its minimum duration when a gap is stretched', () => {
      // ARRANGE: A gap followed by a subtitled clip
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 10, endTime: 15, text: 'A'},
      ];
      service.setSubtitles(initialSubs);
      // Clips are: gap(0-10), sub A(10-15), gap(15-end)
      const gapClip = service.clips()[0];

      // ACT: Stretch the gap far enough that it would normally shrink the subtitle
      // clip to less than its minimum duration (0.5s).
      service.updateClipTimesFromTimeline(gapClip.id, 0, 14.8);

      // ASSERT: The subtitle clip should be clamped to its minimum duration.
      const clips = service.clips();
      const updatedGap = clips[0];
      const updatedSub = clips[1];

      // The subtitle's start time should be clamped to endTime - MIN_SUBTITLE_DURATION:
      expect(updatedSub.startTime).toBe(14.5);
      expect(updatedSub.endTime).toBe(15);
      // The gap should have been prevented from stretching further.
      expect(updatedGap.endTime).toBe(14.5);
    });

    it('preserves the correct anchor when shrinking a subtitled clip below its minimum duration', () => {
      // ARRANGE: A single subtitled clip to test against
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 10, endTime: 15, text: 'A'},
      ];
      service.setSubtitles(initialSubs);
      const subtitleClip = service.clips().find(c => c.hasSubtitle)!;

      // --- ACT 1: Shrink from the RIGHT edge ---
      // Try to shrink the clip to 0.2s duration from the right.
      service.updateClipTimesFromTimeline(subtitleClip.id, 10, 10.2);

      // --- ASSERT 1: The START time should be the anchor ---
      let clips = service.clips();
      let updatedSub = clips.find(c => c.hasSubtitle)!;
      expect(updatedSub.startTime).withContext('Start anchor should be preserved').toBe(10);
      expect(updatedSub.endTime).withContext('End time should be adjusted').toBe(10.5); // 10 + 0.5

      // --- ACT 2: Shrink from the LEFT edge ---
      // Reset state for the second part of the test
      service.setSubtitles(initialSubs);
      // Try to shrink the clip to 0.2s duration from the left.
      service.updateClipTimesFromTimeline(subtitleClip.id, 14.8, 15);

      // --- ASSERT 2: The END time should be the anchor ---
      clips = service.clips();
      updatedSub = clips.find(c => c.hasSubtitle)!;
      expect(updatedSub.startTime).withContext('Start time should be adjusted').toBe(14.5); // 15 - 0.5
      expect(updatedSub.endTime).withContext('End anchor should be preserved').toBe(15);
    });

    it('uses the stationary handle as an anchor when a clip is shrunk below its minimum duration, even when inverted', () => {
      // ARRANGE
      const initialSubs: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-1', startTime: 10, endTime: 15, text: 'A'},
      ];
      service.setSubtitles(initialSubs);
      const subtitleClip = service.clips().find(c => c.hasSubtitle)!;

      // --- ACT 1: Shrink from the RIGHT edge (standard) ---
      service.updateClipTimesFromTimeline(subtitleClip.id, 10, 10.2);

      // --- ASSERT 1: The START time should be the anchor ---
      let clips = service.clips();
      let updatedSub = clips.find(c => c.hasSubtitle)!;
      expect(updatedSub.startTime).withContext('Shrink Right: Start anchor should be preserved').toBe(10);
      expect(updatedSub.endTime).withContext('Shrink Right: End time should be adjusted').toBe(10.5);

      // --- ACT 2: Shrink from the LEFT edge (standard) ---
      service.setSubtitles(initialSubs); // Reset state
      service.updateClipTimesFromTimeline(subtitleClip.id, 14.8, 15);

      // --- ASSERT 2: The END time should be the anchor ---
      clips = service.clips();
      updatedSub = clips.find(c => c.hasSubtitle)!;
      expect(updatedSub.startTime).withContext('Shrink Left: Start time should be adjusted').toBe(14.5);
      expect(updatedSub.endTime).withContext('Shrink Left: End anchor should be preserved').toBe(15);

      // --- ACT 3: Shrink from the RIGHT edge and INVERT ---
      service.setSubtitles(initialSubs); // Reset state
      // Simulate dragging the right handle at 15 past the start handle at 10, to a new position of 9.
      // Wavesurfer might report this as start: 10, end: 9.
      service.updateClipTimesFromTimeline(subtitleClip.id, 10, 9);

      // --- ASSERT 3: The START time should STILL be the anchor ---
      clips = service.clips();
      updatedSub = clips.find(c => c.hasSubtitle)!;
      expect(updatedSub.startTime).withContext('Invert Right: Start anchor should be preserved').toBe(10);
      expect(updatedSub.endTime).withContext('Invert Right: End time should be adjusted').toBe(10.5);
    });
  });

  describe('Boundary Adjustments with Keyboard Shortcuts', () => {
    const srtSubs: SrtSubtitleData[] = [
      {type: 'srt', id: 'srt-1', startTime: 10, endTime: 20, text: 'Subtitle A'},
    ];

    beforeEach(() => {
      projectState.subtitles = cloneDeep(srtSubs);
      service.setSubtitles(cloneDeep(srtSubs));
      // The clips will be: gap(0-10), sub(10-20), gap(20-end)
      // Select the subtitled clip at index 1
      service.setCurrentClipByIndex(1);
    });

    it('should snap playhead to new start time if adjustment moves the boundary past the playhead', fakeAsync(() => {
      // ARRANGE: Playhead is at 10.01s. Default 50ms adjustment will move start boundary to 10.05s, past the playhead.
      currentTimeSignal.set(10.01);

      // ACT: Adjust start boundary to the right by 50ms.
      service.adjustCurrentClipBoundary('start', 'right');
      tick(ADJUST_DEBOUNCE_MS); // Let debounce complete

      // ASSERT: The playhead should be moved to the new start time of 10.05s.
      const newStartTime = 10.05;
      expect(videoStateService.seekAbsolute).toHaveBeenCalledWith(newStartTime);
    }));

    it('should snap playhead when paused exactly at the start and the start boundary is moved right', fakeAsync(() => {
      // ARRANGE: Playhead is exactly at the start time, 10.0s.
      currentTimeSignal.set(10.0);

      // ACT: Adjust start boundary to the right by 50ms, moving it to 10.05s.
      service.adjustCurrentClipBoundary('start', 'right');
      tick(ADJUST_DEBOUNCE_MS);

      // ASSERT: The playhead (at 10.0) is now before the new start (10.05), so it should be snapped.
      const newStartTime = 10.05;
      expect(videoStateService.seekAbsolute).toHaveBeenCalledWith(newStartTime);
    }));

    it('should snap playhead to new end time if adjustment moves the boundary before the playhead', fakeAsync(() => {
      // ARRANGE: Playhead is at 19.99s. Default 50ms adjustment will move end boundary to 19.95s, before the playhead.
      currentTimeSignal.set(19.99);

      // ACT: Adjust end boundary to the left by 50ms.
      service.adjustCurrentClipBoundary('end', 'left');
      tick(ADJUST_DEBOUNCE_MS);

      // ASSERT: The playhead should be moved to just before the new end time.
      const newEndTime = 19.95;
      expect(videoStateService.seekAbsolute).toHaveBeenCalledWith(newEndTime - 0.01);
    }));

    it('should NOT snap playhead if it remains within the new boundaries after adjustment', fakeAsync(() => {
      // ARRANGE: Playhead is at 15s. The 50ms adjustment will not move a boundary past it.
      currentTimeSignal.set(15);

      // ACT: Adjust end boundary to the right (expanding the clip).
      service.adjustCurrentClipBoundary('end', 'right');
      tick(ADJUST_DEBOUNCE_MS);

      // ASSERT: The playhead is still valid, so no seek should occur.
      expect(videoStateService.seekAbsolute).not.toHaveBeenCalled();
    }));

    it('should snap playhead back when shrinking an end boundary while auto-paused exactly at that boundary', fakeAsync(() => {
      // ARRANGE: Playhead is exactly at the end time, 20s.
      currentTimeSignal.set(20);

      // ACT: Adjust end boundary to the left by 50ms, moving it to 19.95s.
      service.adjustCurrentClipBoundary('end', 'left');
      tick(ADJUST_DEBOUNCE_MS);

      // ASSERT: The playhead should be moved to just before the new end time to remain inside the clip.
      const newEndTime = 19.95;
      expect(videoStateService.seekAbsolute).toHaveBeenCalledWith(newEndTime - 0.01);
    }));
  });

  describe('ASS Timing Adjustments', () => {
    const initialAssSubtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Line 1', style: 'Default'}]},
      {type: 'ass', id: 'ass-2', startTime: 15, endTime: 20, parts: [{text: 'Line 2', style: 'Top'}]}
    ];

    beforeEach(() => {
      projectState.rawAssContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Line 1',
        'Dialogue: 0,0:00:15.00,0:00:20.00,Top,,0,0,0,,Line 2'
      ].join('\r\n');
      projectState.subtitles = JSON.parse(JSON.stringify(initialAssSubtitles));
      service.setSubtitles(JSON.parse(JSON.stringify(initialAssSubtitles)));
    });

    it('expands a subtitle clip into an adjacent gap', () => {
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 12);
      const clips = service.clips();
      expect(clips[1].endTime).toBe(12);
      expect(clips[2].startTime).toBe(12);
    });

    it('shrinks a subtitle clip, expanding the adjacent gap', () => {
      const subtitleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(subtitleClip.id, 5, 8);
      const clips = service.clips();
      expect(clips[1].endTime).toBe(8);
      expect(clips[2].startTime).toBe(8);
    });

    it('expands a gap, shrinking the adjacent subtitle clip', () => {
      const gapClip = service.clips().find(c => c.id === 'gap-0')!;
      service.updateClipTimesFromTimeline(gapClip.id, 0, 7);
      const clips = service.clips();
      expect(clips[0].endTime).toBe(7);
      expect(clips[1].startTime).toBe(7);
    });

    it('shrinks a gap, expanding the adjacent subtitle clip', () => {
      const gapClip = service.clips().find(c => c.id === 'gap-10')!;
      service.updateClipTimesFromTimeline(gapClip.id, 12, 15);
      const clips = service.clips();
      expect(clips[2].startTime).toBe(12);
      expect(clips[1].endTime).toBe(12);
    });

    it('creates a gap when shrinking an adjacent clip', () => {
      const adjacentRawContent = `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Clip A
Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,Clip B
      `.trim();
      const adjacentSubs: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Clip A', style: 'Default'}]},
        {type: 'ass', id: 'ass-2', startTime: 10, endTime: 15, parts: [{text: 'Clip B', style: 'Default'}]}
      ];
      projectState.subtitles = adjacentSubs;
      projectState.rawAssContent = adjacentRawContent;
      service.setSubtitles(adjacentSubs);

      const firstSub = service.clips()[1];
      service.updateClipTimesFromTimeline(firstSub.id, 5, 8);
      const clips = service.clips();

      expect(clips.length).toBe(5);
      expect(clips[1].endTime).toBe(8);
      expect(clips[2].hasSubtitle).toBe(false);
    });

    it('consumes an adjacent clip when stretching over it', () => {
      const adjacentSubs: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Clip A', style: 'Default'}]},
        {type: 'ass', id: 'ass-2', startTime: 10, endTime: 15, parts: [{text: 'Clip B', style: 'Default'}]}
      ];
      service.setSubtitles(adjacentSubs);
      const firstSub = service.clips()[1];

      service.updateClipTimesFromTimeline(firstSub.id, 5, 12);

      const clips = service.clips();
      expect(clips[1].endTime).toBe(12);
      expect(clips[2].startTime).toBe(12);
    });

    it('prevents a clip from inverting its start/end times', () => {
      const firstSub = service.clips()[1];
      service.updateClipTimesFromTimeline(firstSub.id, 5, 4);
      const modifiedClip = service.clips()[1];
      // A subtitled clip's min duration is 0.5s
      expect(modifiedClip.endTime).toBeCloseTo(modifiedClip.startTime + 0.5);
    });

    it('correctly updates rawAssContent after multiple consecutive adjustments', () => {
      // --- ACTION 1: First Edit ---
      const initialClip = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(initialClip.id, 4, 9); // New times: 4s to 9s

      // --- ASSERT 1: Verify First Edit ---
      const firstUpdateArgs = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];
      const expectedFirstRawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:04.00,0:00:09.00,Default,,0,0,0,,Line 1',
        'Dialogue: 0,0:00:15.00,0:00:20.00,Top,,0,0,0,,Line 2'
      ].join('\r\n');
      expect(firstUpdateArgs.rawAssContent).toEqual(expectedFirstRawContent);

      // --- ACTION 2: Second Edit ---
      // Re-fetch the clip to get its new ID ('subtitle-4') after the first state update.
      const clipAfterFirstEdit = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(clipAfterFirstEdit.id, 3, 8); // New times: 3s to 8s

      // --- ASSERT 2: Verify Second Edit ---
      const secondUpdateArgs = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];
      const expectedSecondRawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:03.00,0:00:08.00,Default,,0,0,0,,Line 1',
        'Dialogue: 0,0:00:15.00,0:00:20.00,Top,,0,0,0,,Line 2'
      ].join('\r\n');
      expect(secondUpdateArgs.rawAssContent).toEqual(expectedSecondRawContent);
    });

    it('proportionally stretches an animated clip with multiple timings', () => {
      // ARRANGE
      projectState.rawAssContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:50.00,0:00:55.00,Default,,0,0,0,,Animating Text',
        'Dialogue: 0,0:00:55.00,0:01:00.00,Default,,0,0,0,,Animating Text',
      ].join('\r\n');
      projectState.subtitles = [
        {type: 'ass', id: 'ass-1', startTime: 50, endTime: 55, parts: [{text: 'Animating Text', style: 'Default'}]},
        {type: 'ass', id: 'ass-2', startTime: 55, endTime: 60, parts: [{text: 'Animating Text', style: 'Default'}]}
      ];
      service.setSubtitles(projectState.subtitles);

      const animatedClip = service.clips().find(c => c.id === 'subtitle-50')!;
      expect(animatedClip.endTime).toBe(60);
      expect(animatedClip.sourceSubtitles.length).toBe(2);

      // ACT: Stretch the merged clip from 10s duration (50-60) to 20s duration (50-70)
      service.updateClipTimesFromTimeline(animatedClip.id, 50, 70);

      // ASSERT:
      const updateCall = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];
      const newRawContent = updateCall.rawAssContent;
      const updatedSubtitles = updateCall.subtitles as AssSubtitleData[];
      const updatedFrame1 = updatedSubtitles.find(s => s.id === 'ass-1')!;
      const updatedFrame2 = updatedSubtitles.find(s => s.id === 'ass-2')!;

      expect(updatedFrame1.startTime).toBeCloseTo(50);
      expect(updatedFrame1.endTime).toBeCloseTo(60);
      expect(updatedFrame2.startTime).toBeCloseTo(60);
      expect(updatedFrame2.endTime).toBeCloseTo(70);

      expect(newRawContent).toContain('Dialogue: 0,0:00:50.00,0:01:00.00,Default,,0,0,0,,Animating Text');
      expect(newRawContent).toContain('Dialogue: 0,0:01:00.00,0:01:10.00,Default,,0,0,0,,Animating Text');
    });
  });

  describe('Clip Creation, Deletion, and Merging (SRT)', () => {
    beforeEach(() => {
      projectState.subtitles = [
        {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'Subtitle A'},
        {type: 'srt', id: 'srt-2', startTime: 15, endTime: 20, text: 'Subtitle B'}
      ];
      service.setSubtitles(projectState.subtitles);
    });

    it('correctly creates a new subtitle, and then undo/redo the creation', () => {
      const newSubtitle: SrtSubtitleData = {type: 'srt', id: 'srt-new', startTime: 11, endTime: 14, text: 'New'};
      const createCommand = new CreateSubtitledClipCommand(service, newSubtitle);

      commandHistoryService.execute(createCommand);
      let subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3);

      commandHistoryService.undo();
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(2);

      commandHistoryService.redo();
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3);
    });

    it('correctly deletes a subtitle, and then undo/redo the deletion', () => {
      const deleteCommand = new DeleteSubtitledClipCommand(service, ['srt-1']);

      commandHistoryService.execute(deleteCommand);
      let subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(1);

      commandHistoryService.undo();
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(2);

      commandHistoryService.redo();
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(1);
    });

    it('correctly closes a gap by stretching adjacent clips, and then undo/redo the action', () => {
      const mergeCommand = new MergeSubtitledClipsCommand(service, 'subtitle-5', 'subtitle-15');

      commandHistoryService.execute(mergeCommand);
      const clipsAfterMerge = service.clips();
      expect(clipsAfterMerge.length).toBe(4);
      const midpoint = 10 + (15 - 10) / 2.0;
      expect(clipsAfterMerge[1].endTime).toBe(midpoint);
      expect(clipsAfterMerge[2].startTime).toBe(midpoint);

      commandHistoryService.undo();
      expect(service.clips().length).toBe(5);

      commandHistoryService.redo();
      expect(service.clips().length).toBe(4);
    });

    it('correctly splits a subtitled clip at the current playback time and then undoes the split', () => {
      // ARRANGE: Set the current playback time to 8s, which is inside the 5-10s clip.
      videoStateService.setCurrentTime(8);

      const clipToSplit = service.clips().find(c => c.id === 'subtitle-5')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const clipsAfterSplit = service.clips();
      const subtitledClips = clipsAfterSplit.filter(c => c.hasSubtitle);
      // Started with 2 subtitled clips (A and B). Then A was split. The result should be 3 clips: A1, A2, B.
      expect(subtitledClips.length).withContext('After splitting one of two clips, there should be three').toBe(3);

      const splitPoint = 8;
      // First part of the split original clip (originally clip index 1)
      expect(subtitledClips[0].endTime).toBeCloseTo(splitPoint);
      // Second part of the split original clip
      expect(subtitledClips[1].startTime).toBeCloseTo(splitPoint + MIN_GAP_DURATION);

      // UNDO/REDO
      commandHistoryService.undo();
      expect(service.clips().filter(c => c.hasSubtitle).length).withContext('After undo, should be back to two clips').toBe(2);

      commandHistoryService.redo();
      expect(service.clips().filter(c => c.hasSubtitle).length).withContext('After redo, should be back to three clips').toBe(3);
      videoStateService.setCurrentTime(0); // Reset just in case
    });

    it('doesn\'t split a clip that is too short to produce two valid clips and a gap', () => {
      // ARRANGE: Create a clip that is 1.0s long, which is less than the required 1.1s.
      const shortSubtitle: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-short', startTime: 5, endTime: 6, text: 'Short clip'}
      ];
      service.setSubtitles(shortSubtitle);
      // The method being tested requires the current clip to be set.
      service.setCurrentClipByIndex(1); // The subtitled clip is at index 1.
      // Spy on the command history to ensure no command is executed.
      spyOn(commandHistoryService, 'execute');

      // ACT
      service.splitCurrentSubtitledClip();

      // ASSERT
      // The split should have been aborted.
      expect(commandHistoryService.execute).not.toHaveBeenCalled();
      // The number of subtitled clips should remain 1.
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(1);
      // The user should be warned with the correct minimum duration.
      expect(toastService.warn).toHaveBeenCalledWith('Selected clip is too short to split. Minimum required duration is 1.1s.');
    });

    it('clamps the split point to respect minimum clip duration when splitting near the end', () => {
      // ARRANGE: Set the playback time very close to the end of the clip (19.8s in a 15-20s clip)
      videoStateService.setCurrentTime(19.8);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-15')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const clipsAfterSplit = service.clips();
      const subtitledClips = clipsAfterSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3); // Original 'subtitle-5' + the two new pieces

      // The logic is: max split point = end - min_duration - min_gap
      const expectedSplitPoint = 19.4; // 20 - 0.5 - 0.1 = 19.4
      const firstClipPart = subtitledClips[1];
      const secondClipPart = subtitledClips[2];

      expect(firstClipPart.endTime).toBeCloseTo(expectedSplitPoint);
      expect(secondClipPart.startTime).toBeCloseTo(expectedSplitPoint + MIN_GAP_DURATION);
      expect(secondClipPart.endTime).toBe(20);
      expect(secondClipPart.duration).toBeCloseTo(0.5);
      videoStateService.setCurrentTime(0);
    });

    it('clamps the split point to respect minimum clip duration when splitting near the beginning', () => {
      // ARRANGE: Set the playback time very close to the start of the clip (15.2s in a 15-20s clip)
      videoStateService.setCurrentTime(15.2);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-15')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const clipsAfterSplit = service.clips();
      const subtitledClips = clipsAfterSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3);

      // The logic is: min split point = start + min_duration
      const expectedSplitPoint = 15.5; // 15 + 0.5 = 15.5
      const firstClipPart = subtitledClips[1];
      const secondClipPart = subtitledClips[2];

      expect(firstClipPart.startTime).toBe(15);
      expect(firstClipPart.endTime).toBeCloseTo(expectedSplitPoint);
      expect(firstClipPart.duration).toBeCloseTo(0.5);
      expect(secondClipPart.startTime).toBeCloseTo(expectedSplitPoint + MIN_GAP_DURATION);
      expect(secondClipPart.endTime).toBe(20);
      videoStateService.setCurrentTime(0);
    });

    it('correctly performs a second split without affecting the first split', () => {
      // ARRANGE: First split near the end
      videoStateService.setCurrentTime(19.0);
      const clipToSplit1 = service.clips().find(c => c.id === 'subtitle-15')!;
      const command1 = new SplitSubtitledClipCommand(service, clipToSplit1.id, projectState.rawAssContent);
      commandHistoryService.execute(command1);

      let clipsAfterFirstSplit = service.clips();
      const subtitledClips1 = clipsAfterFirstSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips1.length).withContext('After 1st split').toBe(3);

      // ACT: Second split near the beginning of the project
      videoStateService.setCurrentTime(6.0);
      const clipToSplit2 = service.clips().find(c => c.id === 'subtitle-5')!;
      const command2 = new SplitSubtitledClipCommand(service, clipToSplit2.id, projectState.rawAssContent);
      commandHistoryService.execute(command2);

      // ASSERT
      const clipsAfterSecondSplit = service.clips();
      const subtitledClips2 = clipsAfterSecondSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips2.length).withContext('After 2nd split').toBe(4);
      const firstGap = clipsAfterSecondSplit.find(c => c.startTime === 19.0 && c.endTime === 19.1);
      expect(firstGap).withContext('Gap from first split should still exist').toBeDefined();
    });

    it('sets the first new clip as active and nudges the playhead back when splitting in the middle', () => {
      // ARRANGE: Split the 5-10s clip at 7.5s
      videoStateService.setCurrentTime(7.5);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-5')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const newClips = service.clips();
      const firstPart = newClips.find(c => c.startTime === 5 && c.endTime === 7.5)!;
      const indexOfFirstPart = newClips.indexOf(firstPart);

      expect(service.currentClipIndex()).withContext('The first part of the split clip should be active').toBe(indexOfFirstPart);
      expect(videoStateService.seekAbsolute).toHaveBeenCalledWith(7.5 - 0.01);
    });

    it('sets the second new clip as active and preserves playhead position when splitting near the end', () => {
      // ARRANGE: Split the 15-20s clip at 19.8s. The split point will be clamped to 19.4s.
      videoStateService.setCurrentTime(19.8);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-15')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const newClips = service.clips();
      const clampedSplitPoint = 20 - MIN_SUBTITLE_DURATION - MIN_GAP_DURATION; // 19.4
      const secondPart = newClips.find(c => c.startTime === clampedSplitPoint + MIN_GAP_DURATION)!;
      const indexOfSecondPart = newClips.indexOf(secondPart);

      expect(service.currentClipIndex()).withContext('The second part of the split clip should be active').toBe(indexOfSecondPart);
      expect(videoStateService.seekAbsolute).not.toHaveBeenCalled();
    });

    it('sets the first new clip as active and preserves playhead position when splitting near the beginning', () => {
      // ARRANGE: Split the 15-20s clip at 15.2s. The split point will be clamped to 15.5s.
      videoStateService.setCurrentTime(15.2);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-15')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      // ACT
      commandHistoryService.execute(command);

      // ASSERT
      const newClips = service.clips();
      const clampedSplitPoint = 15 + MIN_SUBTITLE_DURATION; // 15.5
      const firstPart = newClips.find(c => c.startTime === 15 && c.endTime === clampedSplitPoint)!;
      const indexOfFirstPart = newClips.indexOf(firstPart);

      expect(service.currentClipIndex()).withContext('The first part of the split clip should be active').toBe(indexOfFirstPart);
      expect(videoStateService.seekAbsolute).not.toHaveBeenCalled();
    });

    it('correctly restores the active clip after undoing a split', () => {
      // ARRANGE: Split the 5-10s clip at 8s. The playhead will be nudged to 7.99s.
      videoStateService.setCurrentTime(8);
      const clipToSplit = service.clips().find(c => c.id === 'subtitle-5')!;
      const command = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);
      commandHistoryService.execute(command);
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(3);

      // ACT: Undo the split
      commandHistoryService.undo();

      // ASSERT
      const restoredClips = service.clips();
      const restoredOriginalClip = restoredClips.find(c => c.startTime === 5 && c.endTime === 10)!;
      const indexOfRestoredClip = restoredClips.indexOf(restoredOriginalClip);

      expect(restoredClips.filter(c => c.hasSubtitle).length).withContext('Should be back to 2 subtitled clips').toBe(2);
      expect(service.currentClipIndex()).withContext('The restored original clip should be active').toBe(indexOfRestoredClip);
    });
  });

  describe('Clip Creation, Deletion, and Merging (ASS)', () => {
    beforeEach(() => {
      projectState.rawAssContent = `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Subtitle A
Dialogue: 0,0:00:15.00,0:00:20.00,Default,,0,0,0,,Subtitle B
Dialogue: 0,0:00:15.00,0:00:20.00,Top,,0,0,0,,Subtitle B Top
      `.trim();
      projectState.subtitles = [
        {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Subtitle A', style: 'Default'}]},
        {
          type: 'ass', id: 'ass-2', startTime: 15, endTime: 20, parts: [
            {text: 'Subtitle B', style: 'Default'},
            {text: 'Subtitle B Top', style: 'Top'}
          ]
        }
      ];
      service.setSubtitles(projectState.subtitles);
    });

    it('correctly creates a new subtitle, and then undo/redo', () => {
      const newSubtitle: AssSubtitleData = {
        type: 'ass',
        id: 'ass-new',
        startTime: 11,
        endTime: 14,
        parts: [{text: 'New', style: 'Default'}]
      };
      const createCommand = new CreateSubtitledClipCommand(service, newSubtitle);

      commandHistoryService.execute(createCommand);
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(3);
      let updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent).toContain('New');

      commandHistoryService.undo();
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(2);
      updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent).not.toContain('New');

      commandHistoryService.redo();
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(3);
    });

    it('correctly deletes a subtitle, and then undo/redo', () => {
      const command = new DeleteSubtitledClipCommand(service, ['ass-2']);

      commandHistoryService.execute(command);
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(1);
      let updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent).not.toContain('Subtitle B');

      commandHistoryService.undo();
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(2);
      updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent).toContain('Subtitle B');

      commandHistoryService.redo();
      expect(service.clips().filter(c => c.hasSubtitle).length).toBe(1);
    });

    it('correctly closes a gap by stretching, and then undo/redo', () => {
      const mergeCommand = new MergeSubtitledClipsCommand(service, 'subtitle-5', 'subtitle-15');

      commandHistoryService.execute(mergeCommand);
      const clipsAfterMerge = service.clips();
      expect(clipsAfterMerge.length).toBe(4);
      const midpoint = 10 + (15 - 10) / 2.0;
      expect(clipsAfterMerge[1].endTime).toBe(midpoint);
      expect(clipsAfterMerge[2].startTime).toBe(midpoint);

      commandHistoryService.undo();
      expect(service.clips().length).toBe(5);

      commandHistoryService.redo();
      expect(service.clips().length).toBe(4);
    });

    it('correctly splits a complex animated clip, and then undo/redo', () => {
      // ARRANGE: An animation with two parts that are merged into a single logical clip
      projectState.rawAssContent = `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Animated Text
Dialogue: 0,0:00:12.00,0:00:14.00,Default,,0,0,0,,Animated Text
    `.trim();
      projectState.subtitles = [
        {type: 'ass', id: 'ass-a', startTime: 10, endTime: 12, parts: [{text: 'Animated Text', style: 'Default'}]},
        {type: 'ass', id: 'ass-b', startTime: 12, endTime: 14, parts: [{text: 'Animated Text', style: 'Default'}]},
      ];
      service.setSubtitles(projectState.subtitles);

      const initialClips = service.clips();
      expect(initialClips.filter(c => c.hasSubtitle).length).withContext('Pre-condition failed: should be one merged clip').toBe(1);
      const clipToSplit = initialClips.find(c => c.hasSubtitle)!;
      const splitPoint = 11.5;
      videoStateService.setCurrentTime(splitPoint);
      const splitCommand = new SplitSubtitledClipCommand(service, clipToSplit.id, projectState.rawAssContent);

      commandHistoryService.execute(splitCommand);

      // ASSERT AFTER EXECUTE
      const clipsAfterSplit = service.clips();
      const subtitledClips = clipsAfterSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips.length).withContext('Should have 2 subtitled clips after split').toBe(2);
      // The timeline should be: [gap, sub, gap, sub, gap]
      expect(clipsAfterSplit.length).withContext('Should be 5 total clips (gap, sub, gap, sub, gap)').toBe(5);

      expect(subtitledClips[0].startTime).toBe(10);
      expect(subtitledClips[0].endTime).toBeCloseTo(11.5);
      expect(subtitledClips[1].startTime).toBeCloseTo(11.5 + MIN_GAP_DURATION);
      expect(subtitledClips[1].endTime).toBeCloseTo(14);

      let updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent.split('Dialogue:').length - 1).withContext('ASS should have 3 lines after split').toBe(3);

      // UNDO
      commandHistoryService.undo();

      // ASSERT AFTER UNDO
      expect(service.clips().filter(c => c.hasSubtitle).length).withContext('Should be 1 clip after undo').toBe(1);
      updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent.split('Dialogue:').length - 1).withContext('ASS should have 2 lines after undo').toBe(2);

      // REDO
      commandHistoryService.redo();

      // ASSERT AFTER REDO
      expect(service.clips().filter(c => c.hasSubtitle).length).withContext('Should be 2 subtitled clips after redo').toBe(2);
      updatedContent = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1].rawAssContent;
      expect(updatedContent.split('Dialogue:').length - 1).withContext('ASS should have 3 lines after redo').toBe(3);
    });

    it('should correctly perform sequential splits on the same initial ASS clip without corruption', () => {
      // ARRANGE: First split near the end of the second subtitled clip ('subtitle-15', from 15s-20s)
      videoStateService.setCurrentTime(19.0);
      const clipToSplit1 = service.clips().find(c => c.id === 'subtitle-15')!;
      const command1 = new SplitSubtitledClipCommand(service, clipToSplit1.id, projectState.rawAssContent);
      commandHistoryService.execute(command1);

      // ASSERT 1: The first split should result in 3 total subtitled clips
      let clipsAfterFirstSplit = service.clips();
      const subtitledClips1 = clipsAfterFirstSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips1.length).withContext('After 1st split, should have 3 subtitled clips').toBe(3);
      expect(clipsAfterFirstSplit.length).withContext('After 1st split, should have 7 total clips').toBe(7);

      // ARRANGE 2: Now, split the first part of the previously split clip.
      // The original 'subtitle-15' (15s-20s) became two clips: (15s - 19s) and (19.1s - 20s).
      // Target the first one by setting the time to 16s:
      videoStateService.setCurrentTime(16.0);
      // Find the new clip dynamically as its ID has changed:
      const clipToSplit2 = service.clips().find(c => c.startTime === 15.0)!;
      expect(clipToSplit2).withContext('Could not find the first part of the previous split').toBeDefined();

      // ACT 2: Execute the second split
      const command2 = new SplitSubtitledClipCommand(service, clipToSplit2.id, projectState.rawAssContent);
      commandHistoryService.execute(command2);

      // ASSERT 2: The final state should be correct
      const clipsAfterSecondSplit = service.clips();
      const subtitledClips2 = clipsAfterSecondSplit.filter(c => c.hasSubtitle);
      expect(subtitledClips2.length).withContext('After 2nd split, should have 4 subtitled clips').toBe(4);
      expect(clipsAfterSecondSplit.length).withContext('After 2nd split, should have 9 total clips').toBe(9);

      // Crucially, verify that the gap from the *first* split still exists and wasn't corrupted:
      const firstGap = clipsAfterSecondSplit.find(c => c.startTime === 19.0 && c.endTime === 19.1);
      expect(firstGap).withContext('Gap from first split should still exist').toBeDefined();

      // And verify the new gap from the second split also exists:
      const secondGap = clipsAfterSecondSplit.find(c => c.startTime === 16.0 && c.endTime === 16.1);
      expect(secondGap).withContext('Gap from second split should exist').toBeDefined();
    });
  });
});
