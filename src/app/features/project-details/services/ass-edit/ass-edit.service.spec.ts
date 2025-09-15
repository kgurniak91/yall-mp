import { TestBed } from '@angular/core/testing';
import { AssEditService } from './ass-edit.service';
import { VideoClip } from '../../../../model/video.types';
import { ClipContent } from '../../../../model/commands/update-clip-text.command';
import { AssSubtitleData, SubtitleData } from '../../../../../../shared/types/subtitle.type';

describe('AssEditService', () => {
  let service: AssEditService;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AssEditService]
    });
    service = TestBed.inject(AssEditService);
  });

  it('edits the text of a clip consisting of a single, simple dialogue line', () => {
    const dialogueLine = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello World';
    const rawAssContent = assFileTemplate(dialogueLine);

    const clip: VideoClip = {
      id: 'subtitle-guid-1',
      startTime: 1,
      endTime: 2,
      duration: 1,
      hasSubtitle: true,
      parts: [{ text: 'Hello World', style: 'Default' }],
      sourceSubtitles: [
        {
          id: 'guid-1',
          type: 'ass',
          startTime: 1,
          endTime: 2,
          parts: [{ text: 'Hello World', style: 'Default' }]
        } as AssSubtitleData
      ]
    };

    const newContent: ClipContent = {
      parts: [{ text: 'Goodbye World', style: 'Default' }]
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
      parts: [{ text: 'Duplicate Text', style: 'Default' }],
      sourceSubtitles: [
        {
          id: 'guid-2a', type: 'ass', startTime: 3, endTime: 4,
          parts: [{ text: 'Duplicate Text', style: 'Default' }]
        } as AssSubtitleData,
        {
          id: 'guid-2b', type: 'ass', startTime: 3, endTime: 4,
          parts: [{ text: 'Duplicate Text', style: 'Default' }]
        } as AssSubtitleData
      ]
    };

    const newContent: ClipContent = {
      parts: [{ text: 'Unique Text', style: 'Default' }]
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
    const originalDialogueBlock = `Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(861.820,-332.345)\\1a&HFF&}Real Usable
Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(895.820,-146.345)}English Lesson
Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(895.820,-146.345)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson
Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(861.820,-332.345)}Real Usable
Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(864.000,396.000)\\1a&HFF&}Real Usable
Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(898.000,582.000)}English Lesson
Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(898.000,582.000)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson
Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(864.000,396.000)}Real Usable`;

    const rawAssContent = assFileTemplate(originalDialogueBlock);

    const sourceSubtitles: SubtitleData[] = [
      ...originalDialogueBlock.matchAll(/^Dialogue:.*/gm)
    ].map((match, index) => {
      const line = match[0];
      const parts = line.split(',');
      const text = parts.slice(9).join(',').replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');
      const style = parts[3];
      const [h1, m1, s1_cs1] = parts[1].split(':');
      const [s1, cs1] = s1_cs1.split('.');
      const startTime = parseInt(h1) * 3600 + parseInt(m1) * 60 + parseInt(s1) + parseInt(cs1) / 100;
      const [h2, m2, s2_cs2] = parts[2].split(':');
      const [s2, cs2] = s2_cs2.split('.');
      const endTime = parseInt(h2) * 3600 + parseInt(m2) * 60 + parseInt(s2) + parseInt(cs2) / 100;

      return {
        id: `anim-${index}`, type: 'ass', startTime, endTime, parts: [{ text, style }]
      } as AssSubtitleData
    });

    const clip: VideoClip = {
      id: 'fc118247-9c22-4188-8379-86fa09580cd0',
      startTime: 59.53,
      endTime: 62.5,
      duration: 2.97,
      hasSubtitle: true,
      parts: [
        { text: 'Real Usable', style: 'Sign-Default' },
        { text: 'English Lesson', style: 'Sign-Default' }
      ],
      sourceSubtitles: sourceSubtitles
    };

    const newContent: ClipContent = {
      parts: [
        { text: 'Real Usable A', style: 'Sign-Default' },
        { text: 'English Lesson B', style: 'Sign-Default' }
      ]
    };

    const expectedDialogueBlock = `Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(861.820,-332.345)\\1a&HFF&}Real Usable A
Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(895.820,-146.345)}English Lesson B
Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(895.820,-146.345)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson B
Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(861.820,-332.345)}Real Usable A
Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&HF4F3F2&\\3a&HD7&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur9\\bord5\\pos(864.000,396.000)\\1a&HFF&}Real Usable A
Dialogue: 0,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\bord5\\blur9\\3c&HF4F3F2&\\3a&HB9&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\b1\\c&HF4F3F2&\\1a&HFF&\\pos(898.000,582.000)}English Lesson B
Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N-CP H\\fs110\\pos(898.000,582.000)\\c&HF4F3F2&\\blur0.7\\bord0}English Lesson B
Dialogue: 1,0:01:00.45,0:01:02.50,Sign-Default,,150,0,0,,{\\an7\\3c&H000000&\\3a&HFF&\\4c&H000000&\\4a&HFF&\\fnKozuka Mincho Pr6N Toaru B\\fs65\\c&HF4F3F2&\\blur0.4\\bord0\\pos(864.000,396.000)}Real Usable A`;

    const result = service.updateClipText(clip, newContent, rawAssContent);
    const expectedFullFile = assFileTemplate(expectedDialogueBlock);
    const normalizedResult = result.replace(/\r\n/g, '\n').trim();
    const normalizedExpected = expectedFullFile.replace(/\r\n/g, '\n').trim();

    expect(normalizedResult).toEqual(normalizedExpected);
  });
});
