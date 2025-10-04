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

  describe('addDialogueLines', () => {
    it('adds a new dialogue line to an existing ASS file', () => {
      const initialContent = assFileTemplate(`Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello`);
      const newSubtitle: AssSubtitleData = {
        type: 'ass',
        id: 'new-sub',
        startTime: 3,
        endTime: 4,
        parts: [{text: 'New Line', style: 'Top', fragments: []}]
      };

      const result = service.createNewDialogueLine(initialContent, newSubtitle);

      expect(result).toContain('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello');
      expect(result).toContain('Dialogue: 0,0:00:03.00,0:00:04.00,Top,,0,0,0,,New Line');
    });

    it('should correctly sort dialogue lines after adding a new one', () => {
      const initialContent = assFileTemplate(`Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Last`);
      const newSubtitle: AssSubtitleData = {
        type: 'ass',
        id: 'new-sub',
        startTime: 1,
        endTime: 2,
        parts: [{text: 'First', style: 'Default', fragments: []}]
      };

      const result = service.createNewDialogueLine(initialContent, newSubtitle);
      const lines = result.split('\n').filter(l => l.startsWith('Dialogue:'));

      expect(lines[0]).toContain('First');
      expect(lines[1]).toContain('Last');
    });
  });

  describe('removeDialogueLines', () => {
    it('removes a single, simple dialogue line', () => {
      const dialogueLine = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello';
      const rawAssContent = assFileTemplate(dialogueLine);
      const clipToRemove: Partial<VideoClip> = {
        hasSubtitle: true,
        sourceSubtitles: [{
          type: 'ass', id: 'sub-1', startTime: 1, endTime: 2, parts: [{text: 'Hello', style: 'Default'}]
        }]
      };

      const result = service.removeDialogueLines(rawAssContent, clipToRemove as VideoClip);

      expect(result).not.toContain(dialogueLine);
    });

    it('removes all dialogue lines associated with a complex multi-part clip', () => {
      const dialogueLines = `
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Part 1
Dialogue: 0,0:00:10.00,0:00:12.00,Top,,0,0,0,,Part 2
Dialogue: 0,0:00:15.00,0:00:16.00,Default,,0,0,0,,Unaffected
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);
      const clipToRemove: Partial<VideoClip> = {
        hasSubtitle: true,
        sourceSubtitles: [
          {type: 'ass', id: 'sub-1', startTime: 10, endTime: 12, parts: [{text: 'Part 1', style: 'Default'}]},
          {type: 'ass', id: 'sub-2', startTime: 10, endTime: 12, parts: [{text: 'Part 2', style: 'Top'}]}
        ]
      };

      const result = service.removeDialogueLines(rawAssContent, clipToRemove as VideoClip);

      expect(result).not.toContain('Part 1');
      expect(result).not.toContain('Part 2');
      expect(result).toContain('Unaffected');
    });
  });

  describe('mergeDialogueLines', () => {
    it('stretches two consecutive clips to meet at the midpoint of the gap', () => {
      const dialogueLines = `
Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Part 1
Dialogue: 0,0:00:08.00,0:00:10.00,Top,,0,0,0,,Part 2
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);

      const clip1: Partial<VideoClip> = {
        startTime: 5, endTime: 6, sourceSubtitles: [
          {type: 'ass', id: 'sub-a', startTime: 5, endTime: 6, parts: [{text: 'Part 1', style: 'Default'}]}
        ]
      };
      const clip2: Partial<VideoClip> = {
        startTime: 8, endTime: 10, sourceSubtitles: [
          {type: 'ass', id: 'sub-b', startTime: 8, endTime: 10, parts: [{text: 'Part 2', style: 'Top'}]}
        ]
      };

      const result = service.mergeDialogueLines(rawAssContent, clip1 as VideoClip, clip2 as VideoClip);

      const expectedLineA = 'Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Part 1';
      const expectedLineB = 'Dialogue: 0,0:00:07.00,0:00:10.00,Top,,0,0,0,,Part 2';

      expect(result).toContain(expectedLineA);
      expect(result).toContain(expectedLineB);
    });
  });

  describe('splitDialogueLines', () => {
    it('splits a simple, single-line clip', () => {
      const dialogueLine = 'Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,This is a test';
      const rawAssContent = assFileTemplate(dialogueLine);
      const splitPoint = 12.5;

      const clipToSplit: Partial<VideoClip> = {
        sourceSubtitles: [{
          type: 'ass', id: 'sub-1', startTime: 10, endTime: 15, parts: [{text: 'This is a test', style: 'Default'}]
        }]
      };

      const newSecondPartSubs: AssSubtitleData[] = [{
        type: 'ass', id: 'sub-2', startTime: splitPoint + 0.1, endTime: 15, parts: [{
          text: 'This is a test',
          style: 'Default'
        }]
      }];

      const result = service.splitDialogueLines(rawAssContent, clipToSplit.sourceSubtitles as AssSubtitleData[], splitPoint, newSecondPartSubs);

      const expectedLine1 = 'Dialogue: 0,0:00:10.00,0:00:12.50,Default,,0,0,0,,This is a test';
      const expectedLine2 = 'Dialogue: 0,0:00:12.60,0:00:15.00,Default,,0,0,0,,This is a test';

      expect(result).toContain(expectedLine1);
      expect(result).toContain(expectedLine2);
      expect(result).not.toContain(dialogueLine);
    });

    it('splits a complex clip with multiple identical dialogue lines for effects', () => {
      const dialogueLines = `
Dialogue: 0,0:00:20.00,0:00:25.00,Default,,0,0,0,,Shadow Text
Dialogue: 1,0:00:20.00,0:00:25.00,Default,,0,0,0,,Shadow Text
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);
      const splitPoint = 22.0;

      const clipToSplit: Partial<VideoClip> = {
        sourceSubtitles: [{
          type: 'ass', id: 'sub-1', startTime: 20, endTime: 25, parts: [{text: 'Shadow Text', style: 'Default'}]
        }]
      };

      const newSecondPartSubs: AssSubtitleData[] = [{
        type: 'ass',
        id: 'sub-2',
        startTime: splitPoint + 0.1,
        endTime: 25,
        parts: [{text: 'Shadow Text', style: 'Default'}]
      }];

      const result = service.splitDialogueLines(rawAssContent, clipToSplit.sourceSubtitles as AssSubtitleData[], splitPoint, newSecondPartSubs);

      const expectedLines = [
        'Dialogue: 0,0:00:20.00,0:00:22.00,Default,,0,0,0,,Shadow Text',
        'Dialogue: 1,0:00:20.00,0:00:22.00,Default,,0,0,0,,Shadow Text',
        'Dialogue: 0,0:00:22.10,0:00:25.00,Default,,0,0,0,,Shadow Text',
        'Dialogue: 1,0:00:22.10,0:00:25.00,Default,,0,0,0,,Shadow Text',
      ];

      for (const line of expectedLines) {
        expect(result).toContain(line);
      }
      expect(result.split('Dialogue:').length - 1).toBe(4);
    });
  });

  describe('unsplitDialogueLines', () => {
    it('re-merges a simple split clip', () => {
      const dialogueLines = `
Dialogue: 0,0:00:10.00,0:00:12.50,Default,,0,0,0,,This is a test
Dialogue: 0,0:00:12.60,0:00:15.00,Default,,0,0,0,,This is a test
      `.trim();
      const rawAssContent = assFileTemplate(dialogueLines);

      const subtitlesToExtend: AssSubtitleData[] = [{
        type: 'ass', id: 'sub-1', startTime: 10, endTime: 12.5, parts: [{text: 'This is a test', style: 'Default'}]
      }];
      const subtitlesToRemove: AssSubtitleData[] = [{
        type: 'ass', id: 'sub-2', startTime: 12.6, endTime: 15, parts: [{text: 'This is a test', style: 'Default'}]
      }];
      const restoredFullSubtitles: AssSubtitleData[] = [{
        type: 'ass', id: 'sub-1', startTime: 10, endTime: 15, parts: [{text: 'This is a test', style: 'Default'}]
      }];

      const result = service.unsplitDialogueLines(rawAssContent, subtitlesToExtend, subtitlesToRemove, restoredFullSubtitles);

      const expectedLine = 'Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,This is a test';
      expect(result).toContain(expectedLine);
      expect(result.split('Dialogue:').length - 1).toBe(1);
    });
  });
});
