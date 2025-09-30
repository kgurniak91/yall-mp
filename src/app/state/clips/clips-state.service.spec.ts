import {fakeAsync, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {MockBuilder} from 'ng-mocks';
import {AssSubtitleData, SrtSubtitleData} from '../../../../shared/types/subtitle.type';
import {VideoClip} from '../../model/video.types';
import {ClipsStateService} from './clips-state.service';
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

describe('ClipsStateService', () => {
  const dependencies = MockBuilder(ClipsStateService)
    .mock(VideoStateService, {
      duration: signal(MOCK_VIDEO_DURATION),
      currentTime: signal(0),
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

  beforeEach(() => {
    (window as any).electronAPI = {
      onPlaybackStateUpdate: jasmine.createSpy('onPlaybackStateUpdateSpy'),
      playbackUpdateClips: jasmine.createSpy('playbackUpdateClipsSpy')
    };
    spectator = createService();
    service = spectator.inject(ClipsStateService);
    appStateService = spectator.inject(AppStateService);
    commandHistoryService = spectator.inject(CommandHistoryStateService);
    commandHistoryService.clearHistory();

    (appStateService.getProjectById as jasmine.Spy).and.returnValue({
      id: 'proj-1',
      subtitles: []
    });
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
      const rawContentForTest = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,Real Usable',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,English Lesson',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,Real Usable',
        'Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,English Lesson',
      ].join('\r\n');

      const initialSubtitles: AssSubtitleData[] = [
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

      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1',
        rawAssContent: rawContentForTest,
        subtitles: initialSubtitles // Provide subtitles for the service to read
      });

      service.setSubtitles(initialSubtitles);

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
      const initialSrtSubtitle: SrtSubtitleData[] = [
        {type: 'srt', id: 'srt-uuid-1', startTime: 10, endTime: 12, text: 'Old text'}
      ];
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
    let projectState: any;

    beforeEach(() => {
      projectState = {
        id: 'proj-1',
        subtitles: JSON.parse(JSON.stringify(initialSrtSubtitles))
      };
      (appStateService.getProjectById as jasmine.Spy).and.callFake(() => projectState);
      (appStateService.updateProject as jasmine.Spy).and.callFake((id, updates) => {
        if (id === 'proj-1') {
          projectState = {...projectState, ...updates};
        }
      });
      service.setProjectId('proj-1');
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
  });

  describe('Clip Timing Adjustments (ASS)', () => {
    const initialAssSubtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Line 1', style: 'Default'}]},
      {type: 'ass', id: 'ass-2', startTime: 5, endTime: 10, parts: [{text: 'Line 2', style: 'Top'}]}
    ];
    let projectState: any;

    beforeEach(() => {
      projectState = {
        id: 'proj-1',
        rawAssContent: [
          '[Events]',
          'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
          'Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Line 1',
          'Dialogue: 0,0:00:05.00,0:00:10.00,Top,,0,0,0,,Line 2'
        ].join('\r\n'),
        subtitles: JSON.parse(JSON.stringify(initialAssSubtitles))
      };
      (appStateService.getProjectById as jasmine.Spy).and.callFake(() => projectState);
      (appStateService.updateProject as jasmine.Spy).and.callFake((id, updates) => {
        if (id === 'proj-1') {
          projectState = {...projectState, ...updates};
        }
      });
      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialAssSubtitles)));
    });

    it('updates all source subtitles when an ASS clip is resized', () => {
      const assClip = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(assClip.id, 4, 11);

      const subtitles = (service as any)._subtitles();
      expect(subtitles[0].startTime).toBe(4);
      expect(subtitles[0].endTime).toBe(11);
      expect(subtitles[1].startTime).toBe(4);
      expect(subtitles[1].endTime).toBe(11);
    });

    it('correctly undoes and redoes an ASS clip adjustment', () => {
      const initialSubtitlesState = JSON.stringify((service as any)._subtitles());
      const assClip = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(assClip.id, 4, 11);
      const modifiedSubtitlesState = JSON.stringify((service as any)._subtitles());

      expect(initialSubtitlesState).not.toEqual(modifiedSubtitlesState);

      commandHistoryService.undo();
      expect(JSON.stringify((service as any)._subtitles())).toEqual(initialSubtitlesState);

      commandHistoryService.redo();
      expect(JSON.stringify((service as any)._subtitles())).toEqual(modifiedSubtitlesState);
    });
  });

  describe('ASS Timing Integration Test', () => {
    it('should correctly update rawAssContent when an ASS clip is resized', () => {
      const rawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Line 1',
        'Dialogue: 0,0:00:05.00,0:00:10.00,Top,,0,0,0,,Line 2'
      ].join('\n');

      const initialAssSubtitles: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Line 1', style: 'Default'}]},
        {type: 'ass', id: 'ass-2', startTime: 5, endTime: 10, parts: [{text: 'Line 2', style: 'Top'}]}
      ];

      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1',
        rawAssContent: rawContent,
        subtitles: initialAssSubtitles
      });

      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialAssSubtitles)));

      const assClip = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(assClip.id, 4, 11);

      const expectedNewContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:04.00,0:00:11.00,Default,,0,0,0,,Line 1',
        'Dialogue: 0,0:00:04.00,0:00:11.00,Top,,0,0,0,,Line 2'
      ].join('\r\n');

      expect(appStateService.updateProject).toHaveBeenCalledOnceWith(
        'proj-1',
        {
          subtitles: jasmine.any(Array),
          rawAssContent: expectedNewContent
        }
      );
    });

    it('should update rawAssContent when expanding a gap adjacent to an ASS clip', () => {
      const rawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,My Subtitle'
      ].join('\n');

      const initialAssSubtitles: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 10, endTime: 15, parts: [{text: 'My Subtitle', style: 'Default'}]}
      ];

      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1',
        rawAssContent: rawContent,
        subtitles: initialAssSubtitles
      });

      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialAssSubtitles)));

      const gapToModify = service.clips().find(c => c.id === 'gap-0')!;

      service.updateClipTimesFromTimeline(gapToModify.id, 0, 12);

      const expectedNewContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:12.00,0:00:15.00,Default,,0,0,0,,My Subtitle'
      ].join('\r\n');

      expect(appStateService.updateProject).toHaveBeenCalledOnceWith(
        'proj-1',
        {
          subtitles: jasmine.any(Array),
          rawAssContent: expectedNewContent
        }
      );
    });

    it('should update rawAssContent when shrinking a gap adjacent to an ASS clip', () => {
      const rawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,My Subtitle'
      ].join('\n');

      const initialAssSubtitles: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 10, endTime: 15, parts: [{text: 'My Subtitle', style: 'Default'}]}
      ];

      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1',
        rawAssContent: rawContent,
        subtitles: initialAssSubtitles
      });

      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialAssSubtitles)));

      const gapToModify = service.clips().find(c => c.id === 'gap-0')!;
      service.updateClipTimesFromTimeline(gapToModify.id, 0, 8);

      const expectedNewContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:08.00,0:00:15.00,Default,,0,0,0,,My Subtitle'
      ].join('\r\n');

      expect(appStateService.updateProject).toHaveBeenCalledOnceWith(
        'proj-1',
        {
          subtitles: jasmine.any(Array),
          rawAssContent: expectedNewContent
        }
      );
    });

    it('should proportionally stretch an animated clip with multiple timings', () => {
      // ARRANGE: Define two CONSECUTIVE subtitle events that will be merged into a single VideoClip.
      // They have the SAME text content, which is how `generateClips` identifies them as mergeable.
      const rawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:50.00,0:00:55.00,Default,,0,0,0,,Animating Text', // Frame 1: 50s to 55s
        'Dialogue: 0,0:00:55.00,0:01:00.00,Default,,0,0,0,,Animating Text', // Frame 2: 55s to 60s
      ].join('\n');
      const initialSubs: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-1', startTime: 50, endTime: 55, parts: [{text: 'Animating Text', style: 'Default'}]},
        {type: 'ass', id: 'ass-2', startTime: 55, endTime: 60, parts: [{text: 'Animating Text', style: 'Default'}]}
      ];
      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1', rawAssContent: rawContent, subtitles: initialSubs
      });
      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialSubs)));

      // Verify that the generator created a single merged clip from 50s to 60s
      const animatedClip = service.clips().find(c => c.id === 'subtitle-50');
      expect(animatedClip).withContext('Merged clip should be defined').toBeDefined();
      expect(animatedClip?.endTime).withContext('Merged clip should end at 60s').toBe(60);
      expect(animatedClip?.sourceSubtitles.length).withContext('Merged clip should have 2 source subtitles').toBe(2);

      // ACT: Stretch the merged clip from 10s duration (50-60) to 20s duration (50-70)
      service.updateClipTimesFromTimeline(animatedClip!.id, 50, 70);

      // ASSERT:
      const updateCall = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];
      const newRawContent = updateCall.rawAssContent;
      const updatedSubtitles = updateCall.subtitles as AssSubtitleData[];

      const updatedFrame1 = updatedSubtitles.find(s => s.id === 'ass-1');
      const updatedFrame2 = updatedSubtitles.find(s => s.id === 'ass-2');

      // Frame 1 was 50% of the duration (5s of 10s). It should now be 50% of 20s = 10s. New time: 50s -> 60s.
      expect(updatedFrame1?.startTime).withContext('Frame 1 new start time').toBeCloseTo(50);
      expect(updatedFrame1?.endTime).withContext('Frame 1 new end time').toBeCloseTo(60);

      // Frame 2 was 50% of the duration (5s of 10s). It should now be 50% of 20s = 10s. New time: 60s -> 70s.
      expect(updatedFrame2?.startTime).withContext('Frame 2 new start time').toBeCloseTo(60);
      expect(updatedFrame2?.endTime).withContext('Frame 2 new end time').toBeCloseTo(70);

      // Verify the raw .ass content reflects these proportional changes
      expect(newRawContent).withContext('Raw content for Frame 1').toContain('Dialogue: 0,0:00:50.00,0:01:00.00,Default,,0,0,0,,Animating Text');
      expect(newRawContent).withContext('Raw content for Frame 2').toContain('Dialogue: 0,0:01:00.00,0:01:10.00,Default,,0,0,0,,Animating Text');
    });

    it('should NOT modify a distant animated clip when another clip is edited', () => {
      // ARRANGE: Define a simple clip and a distant, multi-part ANIMATED clip.
      // The animation frames are consecutive and have the same text, so they will be merged.
      const rawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Simple Clip',
        'Dialogue: 0,0:00:50.00,0:00:52.00,Default,,0,0,0,,Distant Animation',
        'Dialogue: 0,0:00:52.00,0:00:54.00,Default,,0,0,0,,Distant Animation',
      ].join('\n');
      const initialSubs: AssSubtitleData[] = [
        {type: 'ass', id: 'ass-simple', startTime: 5, endTime: 10, parts: [{text: 'Simple Clip', style: 'Default'}]},
        {
          type: 'ass',
          id: 'ass-anim-1',
          startTime: 50,
          endTime: 52,
          parts: [{text: 'Distant Animation', style: 'Default'}]
        },
        {
          type: 'ass',
          id: 'ass-anim-2',
          startTime: 52,
          endTime: 54,
          parts: [{text: 'Distant Animation', style: 'Default'}]
        }
      ];
      (appStateService.getProjectById as jasmine.Spy).and.returnValue({
        id: 'proj-1', rawAssContent: rawContent, subtitles: initialSubs
      });
      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(initialSubs)));

      // ACT: Stretch the simple clip
      const simpleClip = service.clips().find(c => c.id === 'subtitle-5')!;
      service.updateClipTimesFromTimeline(simpleClip.id, 5, 12);

      const updateCall = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];
      const newRawContent = updateCall.rawAssContent;

      // ASSERT: The simple clip's timing IS updated
      expect(newRawContent).toContain('Dialogue: 0,0:00:05.00,0:00:12.00,Default,,0,0,0,,Simple Clip');

      // ASSERT: The distant animated clips' timings ARE NOT updated
      expect(newRawContent).toContain('Dialogue: 0,0:00:50.00,0:00:52.00,Default,,0,0,0,,Distant Animation');
      expect(newRawContent).toContain('Dialogue: 0,0:00:52.00,0:00:54.00,Default,,0,0,0,,Distant Animation');
    });
  });

  describe('ASS Clip Repeated Edits', () => {
    let projectState: any;

    beforeEach(() => {
      projectState = {
        id: 'proj-1',
        rawAssContent: [
          '[Events]',
          'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
          'Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Test Line'
        ].join('\r\n'),
        subtitles: [
          {type: 'ass', id: 'ass-1', startTime: 5, endTime: 10, parts: [{text: 'Test Line', style: 'Default'}]}
        ]
      };

      (appStateService.getProjectById as jasmine.Spy).and.callFake(() => projectState);
      (appStateService.updateProject as jasmine.Spy).and.callFake((id, updates) => {
        if (id === 'proj-1') {
          projectState = {...projectState, ...updates};
        }
      });

      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(projectState.subtitles)));
    });

    it('should correctly update rawAssContent after multiple consecutive timing adjustments', () => {
      // --- ACTION 1: First Edit ---
      const clip = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(clip.id, 4, 9); // New times: 4s to 9s

      // --- ASSERT 1: Verify First Edit ---
      expect(appStateService.updateProject).toHaveBeenCalledTimes(1);
      const firstUpdateArgs = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];

      expect(firstUpdateArgs.subtitles[0].startTime).toBe(4);
      expect(firstUpdateArgs.subtitles[0].endTime).toBe(9);

      const expectedFirstRawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:04.00,0:00:09.00,Default,,0,0,0,,Test Line'
      ].join('\r\n');
      expect(firstUpdateArgs.rawAssContent).toEqual(expectedFirstRawContent);

      // --- ACTION 2: Second Edit on the same clip ---
      const clipAfterFirstEdit = service.clips().find(c => c.hasSubtitle)!;
      service.updateClipTimesFromTimeline(clipAfterFirstEdit.id, 3, 8); // New times: 3s to 8s

      // --- ASSERT 2: Verify Second Edit ---
      expect(appStateService.updateProject).toHaveBeenCalledTimes(2);
      const secondUpdateArgs = (appStateService.updateProject as jasmine.Spy).calls.mostRecent().args[1];

      expect(secondUpdateArgs.subtitles[0].startTime).toBe(3);
      expect(secondUpdateArgs.subtitles[0].endTime).toBe(8);

      const expectedSecondRawContent = [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:03.00,0:00:08.00,Default,,0,0,0,,Test Line'
      ].join('\r\n');
      expect(secondUpdateArgs.rawAssContent).toEqual(expectedSecondRawContent);
    });
  });

  describe('Clip Creation, Deletion, and Merging (SRT)', () => {
    let projectState: any;

    beforeEach(() => {
      projectState = {
        id: 'proj-1',
        subtitles: [
          {type: 'srt', id: 'srt-1', startTime: 5, endTime: 10, text: 'Subtitle A'},
          {type: 'srt', id: 'srt-2', startTime: 15, endTime: 20, text: 'Subtitle B'}
        ]
      };
      (appStateService.getProjectById as jasmine.Spy).and.callFake(() => projectState);
      (appStateService.updateProject as jasmine.Spy).and.callFake((id, updates) => {
        if (id === 'proj-1') {
          projectState = {...projectState, ...updates};
          // When project state changes, the service's internal signal must be updated
          // to simulate the reactive flow that would happen in the real app.
          service.setSubtitles(updates.subtitles || projectState.subtitles);
        }
      });
      service.setProjectId('proj-1');
      service.setSubtitles(JSON.parse(JSON.stringify(projectState.subtitles)));
    });

    it('should correctly create a new subtitle, and then undo/redo the creation', () => {
      const newSubtitle: SrtSubtitleData = {type: 'srt', id: 'srt-new', startTime: 11, endTime: 14, text: 'New'};
      const createCommand = new CreateSubtitledClipCommand(service, newSubtitle);

      // --- EXECUTE ---
      commandHistoryService.execute(createCommand);

      // There should now be 3 subtitled clips.
      let subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3);
      expect(subtitledClips[1].text).toBe('New');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(1);

      // --- UNDO ---
      commandHistoryService.undo();

      // Should be back to 2 subtitled clips.
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(2);
      expect(appStateService.updateProject).toHaveBeenCalledTimes(2);
      expect(service.clips().some(c => c.text === 'New')).toBeFalse();

      // --- REDO ---
      commandHistoryService.redo();

      // Back to 3 subtitled clips again.
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(3);
      expect(subtitledClips[1].text).toBe('New');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(3);
    });

    it('should correctly delete a subtitle, and then undo/redo the deletion', () => {
      const initialSubtitles = (service as any)._subtitles();
      expect(initialSubtitles.length).toBe(2);

      const deleteCommand = new DeleteSubtitledClipCommand(service, 'srt-1');

      // --- EXECUTE ---
      commandHistoryService.execute(deleteCommand);

      // There should now be only 1 subtitled clip.
      let subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(1);
      expect(subtitledClips[0].text).toBe('Subtitle B');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(1);

      // --- UNDO ---
      commandHistoryService.undo();

      // Should be back to 2 subtitled clips.
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(2);
      expect(subtitledClips[0].text).toBe('Subtitle A');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(2);

      // --- REDO ---
      commandHistoryService.redo();

      // Back to 1 subtitled clip again.
      subtitledClips = service.clips().filter(c => c.hasSubtitle);
      expect(subtitledClips.length).toBe(1);
      expect(subtitledClips[0].text).toBe('Subtitle B');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(3);
    });

    it('should correctly merge two clips (delete a gap), and then undo/redo the merge', () => {
      const clipsBeforeMerge = service.clips();
      expect(clipsBeforeMerge.length).toBe(5); // gap, sub, gap, sub, gap
      const firstClipId = 'subtitle-5';
      const secondClipId = 'subtitle-15';

      const mergeCommand = new MergeSubtitledClipsCommand(service, firstClipId, secondClipId);

      // --- EXECUTE ---
      commandHistoryService.execute(mergeCommand);

      // There should be one long subtitled clip and 2 gaps around it.
      const clipsAfterMerge = service.clips();
      expect(clipsAfterMerge.length).toBe(3);
      const mergedClip = clipsAfterMerge[1];
      expect(mergedClip.startTime).toBe(5);
      expect(mergedClip.endTime).toBe(20);
      expect(mergedClip.text).toBe('Subtitle A\nSubtitle B');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(1);

      // --- UNDO ---
      commandHistoryService.undo();

      const clipsAfterUndo = service.clips();
      // Timeline should be restored to its original state.
      expect(clipsAfterUndo.length).toBe(5);
      expect(clipsAfterUndo[1].text).toBe('Subtitle A');
      expect(clipsAfterUndo[3].text).toBe('Subtitle B');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(2);

      // --- REDO ---
      commandHistoryService.redo();

      const clipsAfterRedo = service.clips();
      // Back to the merged state.
      expect(clipsAfterRedo.length).toBe(3);
      expect(clipsAfterRedo[1].endTime).toBe(20);
      expect(clipsAfterRedo[1].text).toBe('Subtitle A\nSubtitle B');
      expect(appStateService.updateProject).toHaveBeenCalledTimes(3);
    });
  });
});
