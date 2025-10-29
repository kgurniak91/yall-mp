import {CompiledASSStyle, Dialogue, ParsedASSEvent} from 'ass-compiler';
import type {AssSubtitleData, SubtitleData, SubtitleFragment} from '../types/subtitle.type';
import {v4 as uuidv4} from 'uuid';

/**
 * Parses a raw ASS dialogue text string (e.g., "{\pos(10,10)}Hello \N{\i1}World{\i0}")
 * into an array of fragments and a clean text representation.
 */
function parseDialogueTextToFragments(text: string): { cleanText: string; fragments: SubtitleFragment[] } {
  const fragments: SubtitleFragment[] = [];
  const cleanTextParts: string[] = [];
  // This regex captures: 1. Tag blocks `{}`, 2. Newline markers `\N`, 3. Plain text content
  const regex = /({[^}]+})|(\\N)|([^{}\\]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, tag, newline, plainText] = match;

    if (tag) {
      fragments.push({text: tag, isTag: true});
    } else if (newline) {
      // For clean text, replace \N with a space. For fragments, store it as a newline in the text part.
      fragments.push({text: '\n', isTag: false});
      cleanTextParts.push(' ');
    } else if (plainText) {
      fragments.push({text: plainText, isTag: false});
      cleanTextParts.push(plainText);
    }
  }

  return {
    // Join parts and replace any literal newlines that might have slipped in.
    cleanText: cleanTextParts.join('').replace(/\n/g, ' ').trim(),
    fragments
  };
}

export function dialoguesToAssSubtitleData(
  compiledDialogues: Dialogue[],
  parsedDialogues: ParsedASSEvent[],
  styles: { [styleName: string]: CompiledASSStyle },
  playResY: number
): AssSubtitleData[] {
  const subtitles: AssSubtitleData[] = [];

  // Pre-filter the parsed dialogues to remove 0-duration lines,
  // ensuring it aligns perfectly with the compiledDialogues array.
  const alignedParsedDialogues = parsedDialogues.filter(p => p.Start !== p.End);

  // Now, both arrays have the same length and their indices correspond
  for (let i = 0; i < compiledDialogues.length; i++) {
    const compiledDialogue = compiledDialogues[i];
    const parsedDialogue = alignedParsedDialogues[i];

    // This check is redundant but kept as a safeguard
    if (!parsedDialogue || compiledDialogue.start !== parsedDialogue.Start) {
      console.error('ASS parsing alignment error. Skipping a dialogue line.', compiledDialogue);
      continue;
    }

    const rawText = parsedDialogue.Text.raw;
    const yPos = calculateYPosition(compiledDialogue, styles, playResY);
    const {cleanText, fragments} = parseDialogueTextToFragments(rawText);

    if (cleanText.trim() || fragments.some(f => f.isTag)) {
      const part = {
        text: cleanText,
        style: compiledDialogue.style,
        fragments,
        y: yPos
      };

      subtitles.push({
        type: 'ass',
        id: uuidv4(),
        startTime: compiledDialogue.start,
        endTime: compiledDialogue.end,
        parts: [part]
      });
    }
  }

  return subtitles;
}

export function arePartsEqual(a: SubtitleData, b: SubtitleData): boolean {
  // If the types are different, they can't be equal.
  if (a.type !== b.type) {
    return false;
  }

  // If both are SRT, compare their text content.
  if (a.type === 'srt' && b.type === 'srt') {
    return a.text === b.text;
  }

  // If both are ASS, compare their parts arrays.
  if (a.type === 'ass' && b.type === 'ass') {
    const partsA = a.parts;
    const partsB = b.parts;

    if (partsA.length !== partsB.length) {
      return false;
    }

    const sortedA = [...partsA].sort((x, y) => (x.style + x.text).localeCompare(y.style + y.text));
    const sortedB = [...partsB].sort((x, y) => (x.style + x.text).localeCompare(y.style + y.text));

    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i].text !== sortedB[i].text || sortedA[i].style !== sortedB[i].style) {
        return false;
      }
    }

    return true;
  }

  // Fallback for any other case (should not be reached with current types).
  return false;
}

export function mergeIdenticalConsecutiveSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  if (subtitles.length < 2) {
    return subtitles;
  }

  const merged: SubtitleData[] = [];
  let current = {...subtitles[0]};

  for (let i = 1; i < subtitles.length; i++) {
    const next = subtitles[i];

    // Check if the next subtitle is consecutive and has the exact same content.
    if (Math.abs(next.startTime - current.endTime) < 0.01 && arePartsEqual(current, next)) {
      // If they are identical, just extend the end time of the current subtitle.
      current.endTime = next.endTime;
    } else {
      // If they are different, push the completed current subtitle and start a new one.
      merged.push(current);
      current = {...next};
    }
  }

  // Push the very last subtitle after the loop finishes.
  merged.push(current);

  return merged;
}

export function calculateYPosition(
  dialogue: Dialogue,
  styles: { [styleName: string]: CompiledASSStyle },
  playResY: number
): number {
  // Absolute position from a \pos(x,y) tag
  if (dialogue.pos?.y !== undefined) {
    return dialogue.pos.y;
  }

  // Absolute start position from a \move tag
  if (dialogue.move?.y1 !== undefined) {
    return dialogue.move.y1;
  }

  // If no absolute position, calculate based on alignment
  let alignment: number | undefined;
  const styleInfo = styles[dialogue.style];

  // An override tag like {\an8} in the dialogue line takes precedence.
  if (dialogue.alignment) {
    alignment = dialogue.alignment;
  }
  // Otherwise, get the alignment from the style definition.
  else if (styleInfo) {
    alignment = styleInfo.style.Alignment;
  }

  if (alignment !== undefined) {
    const verticalMargin = dialogue.margin.vertical;

    // Calculate position using alignment and vertical margin.
    if ([7, 8, 9].includes(alignment)) { // Top alignment
      return verticalMargin;
    }
    if ([1, 2, 3].includes(alignment)) { // Bottom alignment
      return playResY - verticalMargin;
    }
    if ([4, 5, 6].includes(alignment)) { // Middle alignment
      return playResY / 2;
    }
  }

  // Final fallback: If no alignment info, assume it's a standard bottom-aligned dialogue.
  return playResY;
}
