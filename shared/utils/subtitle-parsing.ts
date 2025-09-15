import type {Dialogue, DialogueSlice} from 'ass-compiler';
import type {AssSubtitleData, SubtitleData} from '../types/subtitle.type';
import {v4 as uuidv4} from 'uuid';

export function getCleanTextFromDialogueSlice(slice: DialogueSlice): string {
  return slice.fragments
    .map(fragment => fragment.text.replace(/\\N/g, '\n'))
    .join('');
}

export function dialoguesToAssSubtitleData(dialogues: Dialogue[]): AssSubtitleData[] {
  const subtitles: AssSubtitleData[] = [];

  for (const dialogue of dialogues) {
    const parts = dialogue.slices.map(slice => ({
      text: getCleanTextFromDialogueSlice(slice),
      style: slice.style
    })).filter(part => part.text.trim());

    if (parts.length > 0) {
      subtitles.push({
        type: 'ass',
        id: uuidv4(),
        startTime: dialogue.start,
        endTime: dialogue.end,
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
