import {CompiledASSStyle, Dialogue, ParsedASSEvent, ParsedASSEvents} from 'ass-compiler';
import type {AssSubtitleData, SubtitleData} from '../types/subtitle.type';
import {v4 as uuidv4} from 'uuid';
import {AssSubtitlesUtils} from './ass-subtitles.utils';

export function dialoguesToAssSubtitleData(
  compiledDialogues: Dialogue[],
  parsedDialogues: ParsedASSEvent[],
  styles: { [styleName: string]: CompiledASSStyle },
  playResY: number
): AssSubtitleData[] {
  // Group all dialogues by their exact start and end times.
  // This is the key to bundling visual effect layers together.
  const dialogueGroups = new Map<string, Dialogue[]>();

  for (const compiledDialogue of compiledDialogues) {
    const key = `${compiledDialogue.start}:${compiledDialogue.end}`;
    if (!dialogueGroups.has(key)) {
      dialogueGroups.set(key, []);
    }
    dialogueGroups.get(key)!.push(compiledDialogue);
  }

  const subtitles: AssSubtitleData[] = [];
  const availableParsedDialogues = new Set(parsedDialogues.filter(p => p.Start !== p.End));

  // Iterate over the groups, creating one subtitle object per group.
  for (const group of dialogueGroups.values()) {
    // All dialogues in a group have the same timing.
    const {start, end} = group[0];

    const parts = group.flatMap(compiledDialogue => {
      const isDrawing = compiledDialogue.slices.some(slice =>
        slice.fragments.some(fragment => fragment.drawing)
      );
      if (isDrawing) return [];

      // Reconstruct the clean text from the compiled dialogue to create a reliable matching key
      const compiledCleanText = compiledDialogue.slices
        .flatMap(slice => slice.fragments.map(f => f.text))
        .join('')
        .replace(/\\N/g, '\n')
        .trim();

      let foundParsedDialogue: ParsedASSEvent | undefined;
      for (const p of availableParsedDialogues) {
        // Generate the clean text from the parsed dialogue's raw text
        const {cleanText: parsedCleanText} = AssSubtitlesUtils.parseDialogueTextToFragments(p.Text.raw);

        // Match on timing AND the actual text content
        if (p.Start === start && p.End === end && parsedCleanText === compiledCleanText) {
          foundParsedDialogue = p;
          break;
        }
      }

      if (!foundParsedDialogue) {
        if (start !== end) {
          console.error('ASS parsing alignment error. Could not find a matching parsed event for compiled dialogue:', compiledDialogue);
        }
        return [];
      }

      availableParsedDialogues.delete(foundParsedDialogue);

      const rawText = foundParsedDialogue.Text.raw;
      const yPos = calculateYPosition(compiledDialogue, styles, playResY);
      const {cleanText, fragments} = AssSubtitlesUtils.parseDialogueTextToFragments(rawText);

      if (cleanText.trim() || fragments.some(f => f.isTag)) {
        return {
          text: cleanText,
          style: compiledDialogue.style,
          fragments,
          y: yPos
        };
      }
      return [];
    });

    if (parts.length > 0) {
      subtitles.push({
        type: 'ass',
        id: uuidv4(),
        startTime: start,
        endTime: end,
        track: -1, // Placeholder: Will be overwritten by track assignment logic.
        parts: parts
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

    if (Math.abs(next.startTime - current.endTime) < 0.01 && arePartsEqual(current, next) && current.type === 'ass' && next.type === 'ass') {
      // It's a consecutive, identical ASS subtitle. Merge it.
      current.endTime = next.endTime;

      // Preserve the original, un-merged dialogues for accurate file editing later.
      const originalCurrent = {...current, sourceDialogues: undefined}; // Avoid deep nesting
      const originalNext = {...next, sourceDialogues: undefined};
      current.sourceDialogues = [
        ...(current.sourceDialogues || [originalCurrent]),
        originalNext
      ];

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
  // Step 1: Calculate the anchor Y position
  let anchorY: number;

  // Absolute position from a \pos(x,y) tag
  if (dialogue.pos?.y !== undefined) {
    anchorY = dialogue.pos.y;
  }
  // Absolute start position from a \move tag
  else if (dialogue.move?.y1 !== undefined) {
    anchorY = dialogue.move.y1;
  }
  // If no absolute position, calculate based on alignment
  else {
    let alignment: number | undefined;
    const styleInfo = styles[dialogue.style] || styles['Default'];

    // An override tag like {\an8} in the dialogue line takes precedence
    if (dialogue.alignment) {
      alignment = dialogue.alignment;
    }
    // Otherwise, get the alignment from the style definition
    else if (styleInfo) {
      alignment = styleInfo.style.Alignment;
    }

    if (alignment !== undefined) {
      const verticalMargin = dialogue.margin.vertical;

      // Calculate position using alignment and vertical margin.
      if ([7, 8, 9].includes(alignment)) { // Top alignment
        anchorY = verticalMargin;
      } else if ([1, 2, 3].includes(alignment)) { // Bottom alignment
        anchorY = playResY - verticalMargin;
      } else if ([4, 5, 6].includes(alignment)) { // Middle alignment
        anchorY = playResY / 2;
      } else {
        // Fallback for unknown alignment values
        anchorY = playResY;
      }
    } else {
      // Final fallback: If no alignment info, assume it's a standard bottom-aligned dialogue
      anchorY = playResY;
    }
  }

  // Step 2: Adjust anchor to approximate the top edge based on font size
  let finalY = anchorY;
  const styleInfo = styles[dialogue.style] || styles['Default']; // Fallback to default style
  if (styleInfo) {
    // Check for a font size override tag (\fs) within the dialogue's fragments
    const fsOverride = dialogue.slices
      .flatMap(slice => slice.fragments)
      .map(fragment => fragment.tag.fs)
      .find(fs => fs !== undefined);

    const fontSize = fsOverride ?? styleInfo.style.Fontsize;
    const alignment = dialogue.alignment || styleInfo.style.Alignment;

    if ([4, 5, 6].includes(alignment)) { // Middle alignment
      // The anchor is the vertical center - the top edge is half the font size above that
      finalY = anchorY - (fontSize / 2);
    } else if ([1, 2, 3].includes(alignment)) { // Bottom alignment
      // The anchor is the baseline at the bottom - the top edge is roughly one font size above that
      finalY = anchorY - fontSize;
    }
    // For top alignment ([7, 8, 9]), the anchor is already at the top, so no change is needed
  }

  return finalY;
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
      const {cleanText, fragments} = AssSubtitlesUtils.parseDialogueTextToFragments(masterComment.Text.raw);

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
        track: -1, // Placeholder: Will be overwritten by track assignment logic in electron-main.ts
        sourceDialogues: constituentSubtitles.map(sub => ({...sub, sourceDialogues: undefined}))
      });
    }
  }

  const remainingSubtitles = subtitles.filter((sub) => !processedSubtitleIds.has(sub.id));
  const finalSubtitles = [...remainingSubtitles, ...mergedSubtitles];

  finalSubtitles.sort((a, b) => a.startTime - b.startTime);

  return finalSubtitles;
}

/**
 * Calculates the average vertical position of a subtitle's parts.
 */
export function getAverageY(subtitle: SubtitleData): number | null {
  if (subtitle.type === 'ass' && subtitle.parts.length > 0) {
    const partsWithY = subtitle.parts.filter(p => typeof p.y === 'number');
    if (partsWithY.length > 0) {
      return partsWithY.reduce((sum, part) => sum + part.y!, 0) / partsWithY.length;
    }
  }
  return null;
}

/**
 * Assigns a track number to each subtitle based on temporal overlap and vertical position.
 * Subtitles that are lower on the screen are given priority for lower track numbers.
 */
export function assignTracksToSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  if (subtitles.length === 0) {
    return [];
  }

  const sortedSubtitles = [...subtitles].sort((a, b) => {
    // Check if the subtitles overlap in time.
    const doTheyOverlap = (a.startTime < b.endTime) && (a.endTime > b.startTime);

    if (doTheyOverlap) {
      // If they overlap, prioritize by Y-position (lower on screen comes first).
      const yA = getAverageY(a) ?? Infinity;
      const yB = getAverageY(b) ?? Infinity;
      if (Math.abs(yA - yB) > 1) { // Use a small tolerance for Y comparison
        return yB - yA; // Higher 'y' value means lower on screen, so it gets sorted first.
      }
      // If Y is the same or non-existent, fall back to start time.
      return a.startTime - b.startTime;
    } else {
      // If they do not overlap, simply sort chronologically.
      return a.startTime - b.startTime;
    }
  });

  const trackEndTimes: number[] = [];

  const assignedSubtitles = sortedSubtitles.map(subtitle => {
    const epsilon = 0.001; // Small tolerance for float comparisons
    const availableTrackIndex = trackEndTimes.findIndex(endTime => subtitle.startTime >= endTime - epsilon);

    let assignedTrack: number;

    if (availableTrackIndex !== -1) {
      assignedTrack = availableTrackIndex;
      trackEndTimes[availableTrackIndex] = subtitle.endTime;
    } else {
      assignedTrack = trackEndTimes.length;
      trackEndTimes.push(subtitle.endTime);
    }

    return {
      ...subtitle,
      track: assignedTrack,
    };
  });

  // Re-sort the final array by start time for UI consistency, as the initial sort was for priority.
  return assignedSubtitles.sort((a, b) => a.startTime - b.startTime || a.track - b.track);
}
