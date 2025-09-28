import {AssEditService} from './ass-edit.service';
import {VideoClip} from '../../../../model/video.types';
import {ClipContent} from '../../../../model/commands/update-clip-text.command';
import {createServiceFactory, SpectatorService} from '@ngneat/spectator';
import {AssSubtitleData} from '../../../../../../shared/types/subtitle.type';

const assFileTemplate = (dialogueLines: string) => `
[Script Info]
Title: Test Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Default,Arial,28,&H00FFFFFF
Style: Top,Arial,28,&H00FFFFFF
Style: Sign-Default,Arial,20,&H00FFFFFF

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines}
`.trim();

describe('AssEditService', () => {
  const createService = createServiceFactory(AssEditService);
  let spectator: SpectatorService<AssEditService>;
  let service: AssEditService;

  beforeEach(() => {
    spectator = createService();
    service = spectator.inject(AssEditService);
  });

  describe('updateClipText', () => {
    it('edits the text of a clip consisting of a single, simple dialogue line', () => {
      const dialogueLine = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello World';
      const rawAssContent = assFileTemplate(dialogueLine);

      const clip: VideoClip = {
        id: 'subtitle-guid-1',
        startTime: 1,
        endTime: 2,
        duration: 1,
        hasSubtitle: true,
        parts: [{
          text: 'Hello World',
          style: 'Default'
        }],
        sourceSubtitles: []
      };

      const newContent: ClipContent = {
        parts: [{
          text: 'Goodbye World',
          style: 'Default',
          fragments: [{text: 'Goodbye World', isTag: false}]
        }]
      };

      const expectedLine = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Goodbye World';

      const result = service.updateClipText(clip, newContent, rawAssContent);

      expect(result).toContain(expectedLine);
      expect(result).not.toContain(dialogueLine);
    });

    it('edits the text of a clip made from two identical dialogue lines', () => {
      const dialogueLines = [
        'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Duplicate Text',
        'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Duplicate Text'
      ].join('\r\n');
      const rawAssContent = assFileTemplate(dialogueLines);

      const clip: VideoClip = {
        id: 'subtitle-guid-2',
        startTime: 3,
        endTime: 4,
        duration: 1,
        hasSubtitle: true,
        parts: [{text: 'Duplicate Text', style: 'Default'}],
        sourceSubtitles: []
      };

      const newContent: ClipContent = {
        parts: [{
          text: 'Unique Text',
          style: 'Default',
          fragments: [{text: 'Unique Text', isTag: false}]
        }]
      };

      const expectedLines = [
        'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Unique Text',
        'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Unique Text'
      ];

      const result = service.updateClipText(clip, newContent, rawAssContent);

      expect(result).not.toContain('Duplicate Text');
      expect(result).toContain(expectedLines[0]);
      expect(result).toContain(expectedLines[1]);
    });

    it('edits the text of a complex, multi-line animated clip', () => {
      const dialogueLines = [
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(861.820,-332.345)\\1a&HFF&}Real Usable',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(895.820,-146.345)}English Lesson',
        'Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(895.820,-146.345)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson',
        'Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(861.820,-332.345)}Real Usable',
        'Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(864.000,396.000)\\1a&HFF&}Real Usable',
        'Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(898.000,582.000)}English Lesson',
        'Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(898.000,582.000)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson',
        'Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(864.000,396.000)}Real Usable',
      ].join('\r\n');
      const rawAssContent = assFileTemplate(dialogueLines);

      const clip: VideoClip = {
        id: 'clip-1',
        startTime: 59.53,
        endTime: 62.50,
        duration: 2.97,
        hasSubtitle: true,
        parts: [
          {text: 'Real Usable', style: 'Sign-Default'},
          {text: 'English Lesson', style: 'Sign-Default'}
        ],
        sourceSubtitles: []
      };

      const newContent: ClipContent = {
        parts: [
          {
            text: 'Fake Unusable',
            style: 'Sign-Default',
            fragments: [{text: 'Fake Unusable', isTag: false}]
          },
          {
            text: 'Spanish Siesta',
            style: 'Sign-Default',
            fragments: [{text: 'Spanish Siesta', isTag: false}]
          }
        ]
      };

      const result = service.updateClipText(clip, newContent, rawAssContent);

      const expectedEditedLines = [
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(861.820,-332.345)\\1a&HFF&}Fake Unusable',
        'Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(895.820,-146.345)}Spanish Siesta',
        'Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(895.820,-146.345)\\c&HF4F3F2&\\blur0.7\\bord0}Spanish Siesta',
        'Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(861.820,-332.345)}Fake Unusable',
        'Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(864.000,396.000)\\1a&HFF&}Fake Unusable',
        'Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(898.000,582.000)}Spanish Siesta',
        'Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(898.000,582.000)\\c&HF4F3F2&\\blur0.7\\bord0}Spanish Siesta',
        'Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(864.000,396.000)}Fake Unusable',
      ];

      for (const line of expectedEditedLines) {
        expect(result).toContain(line);
      }

      expect(result).not.toContain('}Real Usable');
      expect(result).not.toContain('}English Lesson');
    });

    it('edits text while preserving inline style tags', () => {
      const dialogueLine = 'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,{\\i1}Anata{\\i0} look like you suck at {\\i1}Eigo{\\i0}.';
      const rawAssContent = assFileTemplate(dialogueLine);

      const clip: VideoClip = {
        id: 'subtitle-guid-3',
        startTime: 10,
        endTime: 12,
        duration: 2,
        hasSubtitle: true,
        parts: [{
          text: 'Anata look like you suck at Eigo.',
          style: 'Default',
          fragments: [
            {text: '{\\i1}', isTag: true},
            {text: 'Anata', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: ' look like you suck at ', isTag: false},
            {text: '{\\i1}', isTag: true},
            {text: 'Eigo', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: '.', isTag: false},
          ]
        }],
        sourceSubtitles: []
      };

      const newContent: ClipContent = {
        parts: [{
          text: 'You look like you are good at English.',
          style: 'Default',
          fragments: [
            {text: '{\\i1}', isTag: true},
            {text: 'You', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: ' look like you are good at ', isTag: false},
            {text: '{\\i1}', isTag: true},
            {text: 'English', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: '.', isTag: false},
          ]
        }]
      };

      const expectedLine = 'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,{\\i1}You{\\i0} look like you are good at {\\i1}English{\\i0}.';

      const result = service.updateClipText(clip, newContent, rawAssContent);

      expect(result).toContain(expectedLine);
      expect(result).not.toContain(dialogueLine);
    });
  });

  describe('stretchClipTimings', () => {
    it('stamps new timings on a single dialogue line', () => {
      const dialogueLine = 'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Hello';
      const rawAssContent = assFileTemplate(dialogueLine);

      const originalSub: AssSubtitleData = {
        type: 'ass', id: 'sub-1', startTime: 10, endTime: 12, parts: [{text: 'Hello', style: 'Default'}]
      };
      const updatedSub: AssSubtitleData = {
        ...originalSub, startTime: 8, endTime: 13
      };

      const result = service.stretchClipTimings([originalSub], [updatedSub], rawAssContent);
      const expectedLine = 'Dialogue: 0,0:00:08.00,0:00:13.00,Default,,0,0,0,,Hello';

      expect(result).toContain(expectedLine);
      expect(result).not.toContain(dialogueLine);
    });

    it('shrinks a single dialogue line proportionally', () => {
      const dialogueLine = 'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Hello';
      const rawAssContent = assFileTemplate(dialogueLine);

      const originalSub: AssSubtitleData = {
        type: 'ass', id: 'sub-1', startTime: 10, endTime: 12, parts: [{text: 'Hello', style: 'Default'}]
      };

      const updatedSub: AssSubtitleData = {
        ...originalSub, startTime: 10.5, endTime: 11.5
      };

      const result = service.stretchClipTimings([originalSub], [updatedSub], rawAssContent);
      const expectedLine = 'Dialogue: 0,0:00:10.50,0:00:11.50,Default,,0,0,0,,Hello';

      expect(result).toContain(expectedLine);
      expect(result).not.toContain(dialogueLine);
    });

    it('stretches a clip containing two consecutive source subtitles', () => {
      const dialogueLines = `
Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Part 1
Dialogue: 0,0:00:06.00,0:00:08.00,Top,,0,0,0,,Part 2
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);

      const originalA: AssSubtitleData = {
        type: 'ass', id: 'sub-a', startTime: 5, endTime: 6, parts: [{text: 'Part 1', style: 'Default'}]
      };
      const originalB: AssSubtitleData = {
        type: 'ass', id: 'sub-b', startTime: 6, endTime: 8, parts: [{text: 'Part 2', style: 'Top'}]
      };

      const updatedA: AssSubtitleData = {...originalA, startTime: 4, endTime: 9};
      const updatedB: AssSubtitleData = {...originalB, startTime: 4, endTime: 9};

      const result = service.stretchClipTimings([originalA, originalB], [updatedA, updatedB], rawAssContent);
      const expectedLineA = 'Dialogue: 0,0:00:04.00,0:00:09.00,Default,,0,0,0,,Part 1';
      const expectedLineB = 'Dialogue: 0,0:00:04.00,0:00:09.00,Top,,0,0,0,,Part 2';

      expect(result).toContain(expectedLineA);
      expect(result).toContain(expectedLineB);
    });

    it('updates duplicate dialogue lines for effects correctly', () => {
      const dialogueLines = `
Dialogue: 0,0:00:20.00,0:00:22.00,Default,,0,0,0,,Shadow Text
Dialogue: 1,0:00:20.00,0:00:22.00,Default,,0,0,0,,Shadow Text
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);

      const originalSub: AssSubtitleData = {
        type: 'ass', id: 'sub-1', startTime: 20, endTime: 22, parts: [{text: 'Shadow Text', style: 'Default'}]
      };
      const updatedSub: AssSubtitleData = {
        ...originalSub, startTime: 20, endTime: 21
      };

      const result = service.stretchClipTimings([originalSub], [updatedSub], rawAssContent);

      const expectedLine = 'Dialogue: 0,0:00:20.00,0:00:21.00,Default,,0,0,0,,Shadow Text';
      const expectedLineLayer1 = 'Dialogue: 1,0:00:20.00,0:00:21.00,Default,,0,0,0,,Shadow Text';

      expect(result).toContain(expectedLine);
      expect(result).toContain(expectedLineLayer1);
    });
  });
});
