import {CompiledASSStyle, Dialogue, ParsedASSEvent, ParsedASSEvents} from 'ass-compiler';
import type {AssSubtitleData, SubtitleData, SubtitleFragment} from '../types/subtitle.type';
import {v4 as uuidv4} from 'uuid';

/**
 * Parses a raw ASS dialogue text string (e.g., "{\pos(10,10)}Hello \N{\i1}World{\i0}")
 * into an array of fragments and a clean text representation.
 */
function parseDialogueTextToFragments(text: string): { cleanText: string; fragments: SubtitleFragment[] } {
  const fragments: SubtitleFragment[] = [];
  const regex = /({[^}]+})|([^{}]+)/g; // Capture either a tag block or a sequence of non-tag characters
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [, tag, plainText] = match;

    if (tag) {
      fragments.push({text: tag, isTag: true});
    } else if (plainText) {
      const fragmentText = plainText.replace(/\\N/g, '\n');
      fragments.push({text: fragmentText, isTag: false});
    }
  }

  const mergedFragments: SubtitleFragment[] = [];
  for (const fragment of fragments) {
    const last = mergedFragments[mergedFragments.length - 1];
    if (last && !last.isTag && !fragment.isTag) {
      // If the last fragment and the current one are both text, merge them.
      last.text += fragment.text;
    } else {
      mergedFragments.push(fragment);
    }
  }

  const cleanText = mergedFragments
    .filter(f => !f.isTag)
    .map(f => f.text)
    .join('')
    .trim();

  return {
    cleanText,
    fragments: mergedFragments
  };
}

export function dialoguesToAssSubtitleData(
  compiledDialogues: Dialogue[],
  parsedDialogues: ParsedASSEvent[],
  styles: { [styleName: string]: CompiledASSStyle },
  playResY: number
): AssSubtitleData[] {
  const subtitles: AssSubtitleData[] = [];
  const availableParsedDialogues = new Set(parsedDialogues.filter(p => p.Start !== p.End));

  for (const compiledDialogue of compiledDialogues) {
    const isDrawing = compiledDialogue.slices.some(slice =>
      slice.fragments.some(fragment => fragment.drawing)
    );

    if (isDrawing) {
      continue;
    }

    // Reconstruct the clean text from the compiled dialogue to create a reliable matching key
    const compiledCleanText = compiledDialogue.slices
      .flatMap(slice => slice.fragments.map(f => f.text))
      .join('')
      .replace(/\\N/g, '\n')
      .trim();

    let foundParsedDialogue: ParsedASSEvent | undefined;
    for (const p of availableParsedDialogues) {
      // Generate the clean text from the parsed dialogue's raw text
      const {cleanText: parsedCleanText} = parseDialogueTextToFragments(p.Text.raw);

      // Match on timing AND the actual text content
      if (p.Start === compiledDialogue.start && p.End === compiledDialogue.end && parsedCleanText === compiledCleanText) {
        foundParsedDialogue = p;
        break;
      }
    }

    if (!foundParsedDialogue) {
      if (compiledDialogue.start !== compiledDialogue.end) {
        console.error('ASS parsing alignment error. Could not find a matching parsed event for compiled dialogue:', compiledDialogue);
      }
      continue;
    }

    availableParsedDialogues.delete(foundParsedDialogue);

    const rawText = foundParsedDialogue.Text.raw;
    const yPos = calculateYPosition(compiledDialogue, styles, playResY);
    const {cleanText, fragments} = parseDialogueTextToFragments(rawText);

    if (cleanText.trim() || fragments.some(f => f.isTag)) {
      subtitles.push({
        type: 'ass',
        id: uuidv4(),
        startTime: compiledDialogue.start,
        endTime: compiledDialogue.end,
        parts: [{
          text: cleanText,
          style: compiledDialogue.style,
          fragments,
          y: yPos
        }]
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

export function mergeKaraokeSubtitles(
  subtitles: AssSubtitleData[],
  parsedEvents: ParsedASSEvents,
): AssSubtitleData[] {
  const karaokeMasterComments = parsedEvents.comment.filter(
    (event) => event.Effect?.name === 'karaoke',
  );

  if (karaokeMasterComments.length === 0) {
    return subtitles;
  }

  // Group master comments that represent the same karaoke line (e.g., Romaji + Translation)
  const masterCommentGroups: ParsedASSEvent[][] = [];
  const sortedMasters = [...karaokeMasterComments].sort((a, b) => a.Start - b.Start);

  if (sortedMasters.length > 0) {
    let currentGroup = [sortedMasters[0]];
    for (let i = 1; i < sortedMasters.length; i++) {
      const current = sortedMasters[i];
      const groupMaxEnd = Math.max(...currentGroup.map(c => c.End));
      // If the current comment starts before the latest end time in the group, it's part of the same group
      if (current.Start < groupMaxEnd) {
        currentGroup.push(current);
      } else {
        masterCommentGroups.push(currentGroup);
        currentGroup = [current];
      }
    }
    masterCommentGroups.push(currentGroup);
  }

  const processedSubtitleIds = new Set<string>();
  const mergedSubtitles: AssSubtitleData[] = [];
  let totalConstituents = 0;

  for (const group of masterCommentGroups) {
    const groupStartTime = Math.min(...group.map(c => c.Start));
    const groupEndTime = Math.max(...group.map(c => c.End));
    const groupStyles = new Set(group.map(c => c.Style));

    // A subtitle is a constituent if it has a matching style and its midpoint falls within the group's time range,
    // OR if it's a short intro animation that is contiguous with the start of the group.
    const constituentSubtitles = subtitles.filter((sub) => {
      if (processedSubtitleIds.has(sub.id) || !sub.parts.some(p => groupStyles.has(p.style))) {
        return false;
      }

      const midPoint = sub.startTime + ((sub.endTime - sub.startTime) / 2);
      const isCenteredInGroup = midPoint >= groupStartTime && midPoint < groupEndTime;

      // Also catch brief intro animations that end exactly where the master comment starts
      const isContiguousAtStart = Math.abs(sub.endTime - groupStartTime) < 0.02;

      return isCenteredInGroup || isContiguousAtStart;
    });

    if (constituentSubtitles.length === 0 && group.length === 0) {
      continue;
    }

    constituentSubtitles.forEach((sub) => processedSubtitleIds.add(sub.id));
    totalConstituents += constituentSubtitles.length;

    const earliestStartTime = constituentSubtitles.length > 0
      ? Math.min(groupStartTime, ...constituentSubtitles.map((s) => s.startTime))
      : groupStartTime;

    const allParts = group.flatMap(masterComment => {
      const {cleanText, fragments} = parseDialogueTextToFragments(masterComment.Text.raw);

      // Find a real subtitle part to inherit Y-position from, prioritizing one with a defined 'y'
      const correspondingConstituent = constituentSubtitles
        .filter(c => c.parts.some(p => p.style === masterComment.Style))
        .sort((a, b) => a.startTime - b.startTime)
        .find(c => c.parts[0]?.y !== undefined);

      return {
        text: cleanText,
        style: masterComment.Style,
        fragments,
        y: correspondingConstituent?.parts[0]?.y,
      };
    });

    if (allParts.length > 0) {
      mergedSubtitles.push({
        type: 'ass',
        id: uuidv4(),
        startTime: earliestStartTime,
        endTime: groupEndTime,
        parts: allParts,
      });
    }
  }

  const remainingSubtitles = subtitles.filter((sub) => !processedSubtitleIds.has(sub.id));
  const finalSubtitles = [...remainingSubtitles, ...mergedSubtitles];

  finalSubtitles.sort((a, b) => a.startTime - b.startTime);

  return finalSubtitles;
}
