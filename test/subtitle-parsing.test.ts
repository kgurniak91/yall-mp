import {describe, expect, it} from 'vitest';
import {compile, Dialogue} from 'ass-compiler';
import type {AssSubtitleData} from '../shared/types/subtitle.type';
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
  const realOutput = dialoguesToAssSubtitleData(dialogues);
  realOutput.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.parts[0].style.localeCompare(b.parts[0].style));

  // Normalize the unpredictable parts (the UUIDs):
  return realOutput.map((subtitle, index) => ({
    ...subtitle,
    id: `test-id-${index}`
  }));
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
