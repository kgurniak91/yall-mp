import {describe, expect, it} from 'vitest';
import {compile, Dialogue, parse} from 'ass-compiler';
import type {AssSubtitleData, SubtitlePart} from '../shared/types/subtitle.type';
import {
  assignTracksToSubtitles,
  dialoguesToAssSubtitleData,
  mergeKaraokeSubtitles
} from '../shared/utils/subtitle-parsing';
import {TEST_CASES, TestCase} from './test-cases';

function buildAssFile(eventLines: string): string {
  return `
[Script Info]
Title: Test File
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Source Sans Pro Semibold,84,&H00FFFFFF,&H000000FF,&H001D1D37,&HC00E0E2E,-1,0,0,0,97,100,0,0,1,5.1,2.7,2,180,180,63,1
Style: mmr3title,A-OTF Jun Pro MMR3 34,69,&H003974E9,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,24,0,1,8,0,7,10,10,10,0
Style: Sign-Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
Style: Romaji,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,5,10,10,10,1
Style: TLED,Arial,22,&H00CCCCCC,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventLines.trim()}
  `.trim();
}

function processAndNormalize(dialogues: Dialogue[], rawAssContent: string): Omit<AssSubtitleData, 'track'>[] {
  const parsedEvents = parse(rawAssContent).events.dialogue;
  const realOutput = dialoguesToAssSubtitleData(dialogues, parsedEvents, {}, 1080);
  const groupedByTimeAndStyle = new Map<string, AssSubtitleData>();

  for (const subtitle of realOutput) {
    const key = `${subtitle.startTime}:${subtitle.endTime}`;
    if (groupedByTimeAndStyle.has(key)) {
      const existing = groupedByTimeAndStyle.get(key)!;
      existing.parts.push(...subtitle.parts);
    } else {
      groupedByTimeAndStyle.set(key, {...subtitle});
    }
  }

  const sortedOutput = Array.from(groupedByTimeAndStyle.values())
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.parts[0].style.localeCompare(b.parts[0].style));

  // Normalize the unpredictable parts (the UUIDs) and remove properties irrelevant to this test.
  return sortedOutput.map((subtitle, index) => {
    const {parts, track, ...rest} = subtitle;
    const partsWithoutY = parts.map(({y, ...partRest}) => partRest);
    // Sort parts to ensure consistent order for comparison
    partsWithoutY.sort((a, b) => (a.style + a.text).localeCompare(b.style + b.text));
    return {
      ...rest,
      id: `test-id-${index}`,
      parts: partsWithoutY
    };
  });
}

describe('Subtitle Parsing', () => {
  TEST_CASES.forEach((testCase: TestCase) => {
    it(`correctly parses: "${testCase.description}"`, () => {
      const assContent = buildAssFile(testCase.dialogueLines);

      // Manually process the "expected" data to match what `dialoguesToAssSubtitleData` actually outputs.
      // This involves grouping by time and merging parts, just like the real function does.
      const expectedGrouped = new Map<string, Omit<AssSubtitleData, 'track'>>();
      for (const sub of testCase.expectedSubtitleData) {
        const key = `${sub.startTime}:${sub.endTime}`;
        if (expectedGrouped.has(key)) {
          const existing = expectedGrouped.get(key)!;
          existing.parts.push(...sub.parts);
        } else {
          const {track, ...rest} = sub;
          expectedGrouped.set(key, {...rest});
        }
      }

      // Finalize the expected data for comparison: sort and normalize.
      const expected = Array.from(expectedGrouped.values())
        .sort((a, b) => a.startTime - b.startTime)
        .map((subtitle, index) => {
          const {parts, ...rest} = subtitle;
          const partsWithoutY = parts.map(({y, ...partRest}) => partRest);
          partsWithoutY.sort((a, b) => (a.style + a.text).localeCompare(b.style + b.text));
          return {
            ...rest,
            id: `test-id-${index}`,
            parts: partsWithoutY
          };
        });

      const compiled = compile(assContent, {});
      const actual = processAndNormalize(compiled.dialogues, assContent);

      expect(actual).toEqual(expected);
    });
  });

  it('ignores 0ms duration dialogue lines used as markers', () => {
    const dialogueLines = `
        Dialogue: 10,0:00:00.00,0:00:00.00,Default,,0,0,0,,{Segment 1}
        Dialogue: 10,0:00:03.41,0:00:04.51,Default,,0,0,0,,Sniff. Sniff. Sniff.
        Dialogue: 10,0:00:04.51,0:00:05.33,Default,,0,0,0,,Sniff. Sniff.
        Dialogue: 10,0:00:40.47,0:00:40.47,Default,,0,0,0,,{Segment 2}
      `;
    const assContent = buildAssFile(dialogueLines);
    const compiled = compile(assContent, {});
    const parsed = parse(assContent);

    const result = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, 1080);

    // The result should only contain the 2 real subtitles, not the 2 markers
    expect(result.length).toBe(2);

    // Verify the content of the remaining subtitles to ensure they are the correct ones
    expect(result[0].parts[0].text).toBe('Sniff. Sniff. Sniff.');
    expect(result[0].startTime).toBe(3.41);
    expect(result[1].parts[0].text).toBe('Sniff. Sniff.');
    expect(result[1].startTime).toBe(4.51);
  });
});

describe('Subtitle Parsing - Positional Logic (calculateYPosition)', () => {
  const PLAY_RES_Y = 1080;
  const DEFAULT_STYLE_FONT_SIZE = 84;

  // Helper to get the first parsed subtitle part from a dialogue line
  const getFirstPart = (eventLines: string): SubtitlePart | undefined => {
    const assContent = buildAssFile(eventLines);
    const compiled = compile(assContent, {});
    const parsed = parse(assContent);
    const playResY = parseInt(compiled.info.PlayResY || '1080', 10);
    const result = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, playResY);
    return result[0]?.parts[0];
  };

  it('prioritizes the y-coordinate from a \\pos tag', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(100,250)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(250 - DEFAULT_STYLE_FONT_SIZE);
  });

  it('uses the y1-coordinate from a \\move tag if \\pos is not present', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\move(100,300,200,400)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(300 - DEFAULT_STYLE_FONT_SIZE);
  });

  it('prioritizes \\pos over \\move', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(100,250)\\move(100,300,200,400)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(250 - DEFAULT_STYLE_FONT_SIZE);
  });

  it('uses an alignment override tag (\\an) over the style definition', () => {
    // Style 'Default' is bottom-aligned (2), but override is top (8). MarginV on the Dialogue line is 30.
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,30,,{\\an8}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(30);
  });

  it('calculates top position from style alignment and MarginV', () => {
    // The 'mmr3title' style has Alignment: 7 (top) and MarginV: 10
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,mmr3title,,0,0,0,,Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(10);
  });

  it('calculates bottom position from style alignment and MarginV', () => {
    // The 'Default' style has Alignment: 2 (bottom), Fontsize: 84, and MarginV: 63
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Text`;
    const part = getFirstPart(line);
    const expectedAnchorY = PLAY_RES_Y - 63; // 1017
    const expectedTopY = expectedAnchorY - DEFAULT_STYLE_FONT_SIZE; // 933
    expect(part?.y).toBe(expectedTopY);
  });

  it('uses the "Default" style if the specified style is not found', () => {
    // This line has a MarginV of 0, so the margin from the fallback 'Default' style (63) should be used.
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,0,,Text`;
    const part = getFirstPart(line);
    // The compiler falls back to the 'Default' style, which has Alignment: 2 (bottom) and MarginV: 63.
    const expectedAnchorY = PLAY_RES_Y - 63;
    const expectedTopY = expectedAnchorY - DEFAULT_STYLE_FONT_SIZE; // 933
    expect(part?.y).toBe(expectedTopY);
  });

  it('respects MarginV override on a Dialogue line even if the style is not found', () => {
    // This line has a MarginV of 50, which should override the style's default.
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,50,,Text`;
    const part = getFirstPart(line);
    // The compiler still falls back to the 'Default' style for Alignment (2), but uses the line's MarginV.
    const expectedAnchorY = PLAY_RES_Y - 50;
    const expectedTopY = expectedAnchorY - DEFAULT_STYLE_FONT_SIZE; // 946
    expect(part?.y).toBe(expectedTopY);
  });

  it('uses alignment override tag when style does not exist', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,25,,{\\an7}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(25);
  });

  it('correctly calculates top Y for large, bottom-aligned font vs smaller bottom-aligned font', () => {
    const eventLines = `
      Dialogue: 10,0:01:02.58,0:01:04.24,Default,,0,0,0,,Oops.
      Dialogue: 1,0:01:02.58,0:01:07.21,Sign-Default,,0,0,0,,{\\fnFrom Where You Are\\fs500\\pos(953,1047)\\blur0.7\\c&HFFFEFF&\\b1}Oops
    `;
    const assContent = buildAssFile(eventLines);
    const compiled = compile(assContent, {});
    const parsed = parse(assContent);
    const subtitles = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, 1080);

    const smallOopsPart = subtitles.find(s => s.parts.some(p => p.style === 'Default'))!.parts[0];
    const largeOopsPart = subtitles.find(s => s.parts.some(p => p.style === 'Sign-Default'))!.parts[0];

    // Default style: Alignment 2 (bottom), Fontsize 84, MarginV 63. Anchor = 1080 - 63 = 1017. Top = 1017 - 84 = 933.
    expect(smallOopsPart.y).toBe(933);

    // Sign-Default style is overridden by \pos(953, 1047) and \fs500. Anchor = 1047. Alignment is from style (2, bottom). Top = 1047 - 500 = 547.
    expect(largeOopsPart.y).toBe(547);

    // The large font subtitle should be considered "higher" on the screen
    expect(largeOopsPart.y!).toBeLessThan(smallOopsPart.y!);
  });
});

describe('mergeKaraokeSubtitles', () => {
  const processSubtitlesAndMergeKaraoke = (eventLines: string): AssSubtitleData[] => {
    const assContent = buildAssFile(eventLines);
    const compiled = compile(assContent, {});
    const parsed = parse(assContent);
    const initialSubtitles = dialoguesToAssSubtitleData(
      compiled.dialogues,
      parsed.events.dialogue,
      compiled.styles,
      1080
    );

    return mergeKaraokeSubtitles(initialSubtitles, parsed.events);
  };

  it('merges a simple karaoke line with its fragments', () => {
    const events = `
      Comment: 0,0:00:10.00,0:00:15.00,Romaji,,0,0,0,karaoke,{\\k50}He{\\k50}llo
      Dialogue: 0,0:00:10.00,0:00:10.50,Romaji,,0,0,0,,H
      Dialogue: 0,0:00:10.50,0:00:11.00,Romaji,,0,0,0,,e
      Dialogue: 0,0:00:11.00,0:00:11.50,Romaji,,0,0,0,,l
      Dialogue: 0,0:00:11.50,0:00:12.00,Romaji,,0,0,0,,l
      Dialogue: 0,0:00:12.00,0:00:12.50,Romaji,,0,0,0,,o
    `;
    const result = processSubtitlesAndMergeKaraoke(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startTime: 10.00,
      endTime: 15.00,
      parts: [
        {
          text: 'Hello',
          style: 'Romaji',
          fragments: expect.any(Array),
        }
      ]
    });
  });

  it('includes contiguous intro animations in the merged clip', () => {
    const events = `
      Comment: 0,0:00:20.00,0:00:25.00,Romaji,,0,0,0,karaoke,Hello
      Dialogue: 0,0:00:19.50,0:00:20.00,Romaji,,0,0,0,,{fx-intro}
      Dialogue: 0,0:00:20.00,0:00:25.00,Romaji,,0,0,0,,Hello
    `;
    const result = processSubtitlesAndMergeKaraoke(events);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe(19.50);
    expect(result[0].endTime).toBe(25.00);
  });

  it('merges overlapping Romaji and Translation master comments into one clip with two parts', () => {
    const events = `
      Comment: 0,0:00:30.00,0:00:35.00,Romaji,,0,0,0,karaoke,Konnichiwa
      Comment: 0,0:00:30.00,0:00:35.00,TLED,,0,0,0,karaoke,Good afternoon
      Dialogue: 0,0:00:30.00,0:00:35.00,Romaji,,0,0,0,,Konnichiwa
      Dialogue: 0,0:00:30.00,0:00:35.00,TLED,,0,0,0,,Good afternoon
    `;
    const result = processSubtitlesAndMergeKaraoke(events);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe(30.00);
    expect(result[0].endTime).toBe(35.00);
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts.map(p => p.style).sort()).toEqual(['Romaji', 'TLED']);
  });

  it('doesn\'t merge staggered, consecutive karaoke lines and keep them separate', () => {
    const events = `
      Comment: 0,0:00:40.00,0:00:45.00,Romaji,,0,0,0,karaoke,First line
      Comment: 0,0:00:46.00,0:00:50.00,Romaji,,0,0,0,karaoke,Second line
      Dialogue: 0,0:00:39.80,0:00:45.00,Romaji,,0,0,0,,(animations for first line)
      Dialogue: 0,0:00:45.80,0:00:50.00,Romaji,,0,0,0,,(animations for second line)
      Dialogue: 0,0:00:45.20,0:00:45.80,Default,,0,0,0,,A normal subtitle in between.
    `;
    const result = processSubtitlesAndMergeKaraoke(events);

    // Should result in 3 subtitles total: the two merged karaoke lines, and the one normal dialogue.
    expect(result).toHaveLength(3);

    // First karaoke line
    expect(result[0]).toMatchObject({
      startTime: 39.80,
      endTime: 45.00,
      parts: [{text: 'First line', style: 'Romaji'}]
    });

    // Untouched normal subtitle
    expect(result[1]).toMatchObject({
      startTime: 45.20,
      endTime: 45.80,
      parts: [{text: 'A normal subtitle in between.', style: 'Default'}]
    });

    // Second karaoke line
    expect(result[2]).toMatchObject({
      startTime: 45.80,
      endTime: 50.00,
      parts: [{text: 'Second line', style: 'Romaji'}]
    });
  });

  it('doesn\'t merge anything if no karaoke comments are present', () => {
    const events = `
      Dialogue: 0,0:00:50.00,0:00:52.00,Default,,0,0,0,,Line 1
      Dialogue: 0,0:00:53.00,0:00:55.00,Default,,0,0,0,,Line 2
    `;
    const result = processSubtitlesAndMergeKaraoke(events);

    expect(result).toHaveLength(2);
    expect(result[0].parts[0].text).toBe('Line 1');
    expect(result[1].parts[0].text).toBe('Line 2');
  });
});

describe('assignTracksToSubtitles', () => {
  it('should assign a lower track to a subtitle that is lower on screen, even if it starts later', () => {
    // ARRANGE:
    const dialogueLines = `
      Dialogue: 0,0:00:25.58,0:00:29.96,Sign-Default,,0,0,0,,{\\fnDFPMaruGothic-W6-Kami\\fs150\\pos(974,758)}Not Edible
      Dialogue: 1,0:00:25.58,0:00:29.96,Sign-Default,,0,0,0,,{\\fnDFPMaruGothic-W6-Kami\\fs150\\c&H181818\\pos(974,758)}Not Edible
      Dialogue: 10,0:00:26.77,0:00:29.34,Default,,0,0,0,,Strike!
    `;
    const assContent = buildAssFile(dialogueLines);
    const compiled = compile(assContent, {});
    const parsed = parse(assContent);
    const subtitlesWithoutTracks = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, 1080);

    // ACT
    const subtitlesWithTracks = assignTracksToSubtitles(subtitlesWithoutTracks);

    // ASSERT
    const notEdibleSubtitle = subtitlesWithTracks.find(s => s.type === 'ass' && s.parts.some(p => p.text === 'Not Edible')) as AssSubtitleData | undefined;
    const strikeSubtitle = subtitlesWithTracks.find(s => s.type === 'ass' && s.parts.some(p => p.text === 'Strike!')) as AssSubtitleData | undefined;

    expect(notEdibleSubtitle).toBeDefined();
    expect(strikeSubtitle).toBeDefined();

    expect(notEdibleSubtitle!.parts[0].y).toBe(608);
    expect(strikeSubtitle!.parts[0].y).toBe(933);

    expect(strikeSubtitle!.track).toBe(0);
    expect(notEdibleSubtitle!.track).toBe(1);
  });

  it('should place two non-overlapping subtitles on the same track', () => {
    const subtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'a', startTime: 10, endTime: 12, parts: [{text: 'A', style: 's', y: 900}], track: -1},
      {type: 'ass', id: 'b', startTime: 14, endTime: 16, parts: [{text: 'B', style: 's', y: 900}], track: -1},
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'a')!.track).toBe(0);
    expect(result.find(s => s.id === 'b')!.track).toBe(0);
  });

  it('should place simple overlapping subtitles on different tracks based on start time', () => {
    const subtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'a', startTime: 10, endTime: 14, parts: [{text: 'A', style: 's'}], track: -1},
      {type: 'ass', id: 'b', startTime: 12, endTime: 16, parts: [{text: 'B', style: 's'}], track: -1},
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'a')!.track).toBe(0);
    expect(result.find(s => s.id === 'b')!.track).toBe(1);
  });

  it('should reuse a track once it becomes available', () => {
    const subtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'a', startTime: 10, endTime: 14, parts: [{text: 'A', style: 's', y: 900}], track: -1},
      {type: 'ass', id: 'b', startTime: 12, endTime: 16, parts: [{text: 'B', style: 's', y: 800}], track: -1},
      {type: 'ass', id: 'c', startTime: 15, endTime: 18, parts: [{text: 'C', style: 's', y: 900}], track: -1},
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'a')!.track).toBe(0);
    expect(result.find(s => s.id === 'b')!.track).toBe(1);
    expect(result.find(s => s.id === 'c')!.track).toBe(0);
  });

  it('should prioritize the lower subtitle when two start simultaneously', () => {
    const subtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'higher', startTime: 10, endTime: 15, parts: [{text: 'Higher', style: 's', y: 800}], track: -1},
      {type: 'ass', id: 'lower', startTime: 10, endTime: 15, parts: [{text: 'Lower', style: 's', y: 900}], track: -1},
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'lower')!.track).toBe(0);
    expect(result.find(s => s.id === 'higher')!.track).toBe(1);
  });

  it('should place perfectly adjacent subtitles on the same track', () => {
    const subtitles: AssSubtitleData[] = [
      {type: 'ass', id: 'a', startTime: 10, endTime: 12, parts: [{text: 'A', style: 's', y: 900}], track: -1},
      {type: 'ass', id: 'b', startTime: 12, endTime: 14, parts: [{text: 'B', style: 's', y: 900}], track: -1},
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'a')!.track).toBe(0);
    expect(result.find(s => s.id === 'b')!.track).toBe(0);
  });

  it('should assign tracks correctly for a fully contained subtitle based on y-position', () => {
    const subtitles: AssSubtitleData[] = [
      {
        type: 'ass',
        id: 'longer_higher',
        startTime: 10,
        endTime: 20,
        parts: [{text: 'A', style: 's', y: 800}],
        track: -1
      },
      {
        type: 'ass',
        id: 'shorter_lower',
        startTime: 12,
        endTime: 15,
        parts: [{text: 'B', style: 's', y: 900}],
        track: -1
      },
    ];
    const result = assignTracksToSubtitles(subtitles);
    expect(result.find(s => s.id === 'shorter_lower')!.track).toBe(0);
    expect(result.find(s => s.id === 'longer_higher')!.track).toBe(1);
  });
});
