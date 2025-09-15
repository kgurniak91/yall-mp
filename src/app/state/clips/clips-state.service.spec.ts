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

describe('ClipsStateService', () => {
  const dependencies = MockBuilder(ClipsStateService)
    .mock(VideoStateService, {
      duration: signal(MOCK_VIDEO_DURATION),
      currentTime: signal(0),
    })
    .mock(GlobalSettingsStateService, {
      boundaryAdjustAmountMs: signal(50),
    })
    .mock(AssEditService, {
      updateClipText: jasmine.createSpy('updateClipText').and.returnValue('new raw ass content')
    })
    .mock(AppStateService, {
      getProjectById: jasmine.createSpy('getProjectById').and.returnValue({
        id: 'proj-1',
        rawAssContent: 'old raw ass content'
      }),
      updateProject: jasmine.createSpy('updateProject')
    })
    .mock(CommandHistoryStateService)
    .mock(ToastService)
    .build();

  const createService = createServiceFactory({
    service: ClipsStateService,
    ...dependencies
  });

  let spectator: SpectatorService<ClipsStateService>;
  let service: ClipsStateService;
  let assEditService: AssEditService;
  let appStateService: AppStateService;

  beforeEach(() => {
    spectator = createService();
    service = spectator.inject(ClipsStateService);
    assEditService = spectator.inject(AssEditService);
    appStateService = spectator.inject(AppStateService);
  });

  describe('Clip Generation', () => {
    TEST_CASES.forEach((testCase: TestCase) => {
      it(`generates correct VideoClips for test case: "${testCase.description}"`, () => {
        service.setSubtitles(testCase.expectedSubtitleData);
        const actualClips = service.clips();

        const simplifiedActual = actualClips.map(clip => ({
          id: clip.id,
          startTime: clip.startTime,
          endTime: clip.endTime,
          hasSubtitle: clip.hasSubtitle,
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
      service.setSubtitles(initialSubtitles);

      const clipBeforeEdit: VideoClip = service.clips().find(c => c.hasSubtitle)!;
      const newContent = {
        parts: [
          {text: 'Real Usable EDITED', style: 'Sign-Default'},
          {text: 'English Lesson', style: 'Sign-Default'}
        ]
      };

      service.updateClipText('proj-1', clipBeforeEdit, newContent);

      expect(assEditService.updateClipText).toHaveBeenCalledOnceWith(clipBeforeEdit, newContent, 'old raw ass content');
      expect(appStateService.updateProject).toHaveBeenCalledOnceWith('proj-1', {rawAssContent: 'new raw ass content'});

      const clipAfterEdit = service.clips().find(c => c.hasSubtitle)!;
      const finalSubtitles = clipAfterEdit.sourceSubtitles as AssSubtitleData[];

      expect(finalSubtitles.find(s => s.id === 'uuid-1')?.parts[0].text).toBe('Real Usable EDITED');
      expect(finalSubtitles.find(s => s.id === 'uuid-2')?.parts[0].text).toBe('English Lesson');
      expect(finalSubtitles.find(s => s.id === 'uuid-3')?.parts[0].text).toBe('Real Usable EDITED');
      expect(finalSubtitles.find(s => s.id === 'uuid-4')?.parts[0].text).toBe('English Lesson');
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
});
