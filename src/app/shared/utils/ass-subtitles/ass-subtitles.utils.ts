interface ParsedAssEvents {
  header: string; // Everything before and including "[Events]"
  formatLine: string;
  dialogueLines: string[];
  formatSpec: Map<string, number>;
}

export class AssSubtitlesUtils {

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

    const timeToSeconds = (timeStr: string): number => {
      const [h, m, s] = timeStr.split(':').map(parseFloat);
      return (h * 3600) + (m * 60) + s;
    };

    const relevantDialogueLines = dialogueLines.filter(line => {
      const parts = line.split(',');
      if (parts.length <= Math.max(startIndex, endIndex)) return false;

      const lineStartTime = timeToSeconds(parts[startIndex]);
      const lineEndTime = timeToSeconds(parts[endIndex]);

      // An ASS line is relevant if it overlaps at all with the clip's time range.
      return lineStartTime < endTime && lineEndTime > startTime;
    });

    // Reconstruct the ASS file with only the filtered dialogue lines
    return `${header}[Events]\n${formatLine}\n${relevantDialogueLines.join('\n')}`;
  }
}
