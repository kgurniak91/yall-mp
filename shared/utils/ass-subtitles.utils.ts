import {SubtitleFragment} from '../types/subtitle.type';

interface ParsedAssEvents {
  header: string; // Everything before and including "[Events]"
  formatLine: string;
  dialogueLines: string[];
  formatSpec: Map<string, number>;
}

export class AssSubtitlesUtils {

  /**
   * Parses the raw ASS content into its constituent parts for easier manipulation.
   */
  static parseEvents(rawAssContent: string): ParsedAssEvents | null {
    const eventsHeader = '[Events]';
    const eventsIndex = rawAssContent.toLowerCase().indexOf(eventsHeader.toLowerCase());
    if (eventsIndex === -1) {
      return null;
    }

    const header = rawAssContent.substring(0, eventsIndex);
    const eventsContent = rawAssContent.substring(eventsIndex);
    const lines = eventsContent.split(/\r?\n/);

    const formatLine = lines.find(line => line.toLowerCase().startsWith('format:'));
    if (!formatLine) {
      return null;
    }

    const dialogueLines = lines.filter(line => line.toLowerCase().startsWith('dialogue:'));

    const formatParts = formatLine.substring('format:'.length).trim().split(',').map(p => p.trim());
    const formatSpec = new Map<string, number>();
    formatParts.forEach((part, index) => {
      formatSpec.set(part, index);
    });

    return {header, formatLine, dialogueLines, formatSpec};
  }

  /**
   * Parses a raw ASS dialogue text string (e.g., "{\pos(10,10)}Hello \N{\i1}World{\i0}")
   * into an array of fragments and a clean text representation.
   */
  static parseDialogueTextToFragments(text: string): { cleanText: string; fragments: SubtitleFragment[] } {
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

  /**
   * Filters raw ASS content to only include dialogue lines within a specific time range.
   * This preserves all original styling and data.
   */
  static scopeAssContent(rawAssContent: string, startTime: number, endTime: number): string | undefined {
    const parsed = this.parseEvents(rawAssContent);

    if (!parsed) {
      return undefined;
    }

    const {header, formatLine, dialogueLines, formatSpec} = parsed;

    const startIndex = formatSpec.get('Start');
    const endIndex = formatSpec.get('End');

    if (startIndex === undefined || endIndex === undefined) {
      console.error("ASS 'Format' line is missing 'Start' or 'End' fields.");
      return undefined;
    }

    const relevantDialogueLines = dialogueLines.filter(line => {
      const parts = line.split(',');
      if (parts.length <= Math.max(startIndex, endIndex)) return false;

      const lineStartTime = AssSubtitlesUtils.timeToSeconds(parts[startIndex]);
      const lineEndTime = AssSubtitlesUtils.timeToSeconds(parts[endIndex]);

      // An ASS line is relevant if it overlaps at all with the clip's time range.
      return lineStartTime < endTime && lineEndTime > startTime;
    });

    // Reconstruct the ASS file with only the filtered dialogue lines
    return `${header}[Events]\n${formatLine}\n${relevantDialogueLines.join('\n')}`;
  }

  /**
   * Converts seconds into the H:MM:SS.ss format required by ASS files.
   */
  static formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.round((seconds - Math.floor(seconds)) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  /**
   * Converts the H:MM:SS.ss format required by ASS files into seconds.
   */
  static timeToSeconds(timeStr: string): number {
    const [h, m, s] = timeStr.split(':').map(parseFloat);
    return (h * 3600) + (m * 60) + s;
  }

  /**
   * Rounds a time in seconds to the two-decimal precision required by the ASS format.
   */
  static roundToAssPrecision(seconds: number): number {
    return Math.round(seconds * 100) / 100;
  }

  /**
   * Converts an array of subtitle fragments back into a single raw ASS text string.
   */
  static fragmentsToText(fragments: SubtitleFragment[] | undefined): string {
    if (!fragments || fragments.length === 0) {
      return '';
    }
    return fragments.map(f => f.text.replace(/\n/g, '\\N')).join('');
  }
}
