import {describe, expect, it} from 'vitest';
import {compile, Dialogue} from 'ass-compiler';
import type {AssSubtitleData, SubtitlePart} from '../shared/types/subtitle.type';
import {dialoguesToAssSubtitleData} from '../shared/utils/subtitle-parsing';
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

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventLines.trim()}
  `.trim();
}

function processAndNormalize(dialogues: Dialogue[]): AssSubtitleData[] {
  const realOutput = dialoguesToAssSubtitleData(dialogues, {}, 1080);
  realOutput.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.parts[0].style.localeCompare(b.parts[0].style));

  // Normalize the unpredictable parts (the UUIDs) and remove the 'y' property as it's irrelevant in this context:
  return realOutput.map((subtitle, index) => {
    const {parts, ...rest} = subtitle;
    const partsWithoutY = parts.map(({y, ...partRest}) => partRest);
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
      const expected = testCase.expectedSubtitleData;

      const compiled = compile(assContent, {});
      const actual = processAndNormalize(compiled.dialogues);

      expect(actual).toEqual(expected);
    });
  });
});

describe('Subtitle Parsing - Positional Logic (calculateYPosition)', () => {
  const PLAY_RES_Y = 1080;

  // Helper to get the first parsed subtitle part from a dialogue line
  const getFirstPart = (eventLines: string): SubtitlePart | undefined => {
    const assContent = buildAssFile(eventLines);
    const compiled = compile(assContent, {});
    const playResY = parseInt(compiled.info.PlayResY, 10);
    const result = dialoguesToAssSubtitleData(compiled.dialogues, compiled.styles, playResY);
    return result[0]?.parts[0];
  };

  it('prioritizes the y-coordinate from a \\pos tag', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(100,250)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(250);
  });

  it('uses the y1-coordinate from a \\move tag if \\pos is not present', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\move(100,300,200,400)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(300);
  });

  it('prioritizes \\pos over \\move', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(100,250)\\move(100,300,200,400)}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(250);
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
    // The 'Default' style has Alignment: 2 (bottom) and MarginV: 63
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(PLAY_RES_Y - 63);
  });

  it('uses the "Default" style if the specified style is not found', () => {
    // This line has a MarginV of 0, so the margin from the fallback 'Default' style (63) should be used.
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,0,,Text`;
    const part = getFirstPart(line);
    // The compiler falls back to the 'Default' style, which has Alignment: 2 (bottom) and MarginV: 63.
    const expectedY = PLAY_RES_Y - 63;
    expect(part?.y).toBe(expectedY); // 1080 - 63 = 1017
  });

  it('respects MarginV override on a Dialogue line even if the style is not found', () => {
    // This line has a MarginV of 50, which should override the style's default.
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,50,,Text`;
    const part = getFirstPart(line);
    // The compiler still falls back to the 'Default' style for Alignment (2), but uses the line's MarginV.
    const expectedY = PLAY_RES_Y - 50;
    expect(part?.y).toBe(expectedY); // 1080 - 50 = 1030
  });

  it('uses alignment override tag when style does not exist', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,NonExistentStyle,,0,0,25,,{\\an7}Text`;
    const part = getFirstPart(line);
    expect(part?.y).toBe(25);
  });
});
