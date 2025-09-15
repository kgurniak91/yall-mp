import {Injectable} from '@angular/core';
import {VideoClip} from '../../../../model/video.types';
import {ClipContent} from '../../../../model/commands/update-clip-text.command';

@Injectable()
export class AssEditService {

  public stretchClipTimings(
    clip: VideoClip,
    newStartTime: number,
    newEndTime: number,
    rawAssContent: string
  ): string {
    if (!clip.hasSubtitle || clip.sourceSubtitles.length === 0) {
      return rawAssContent;
    }

    const formatSpec = this.parseFormatLine(rawAssContent);
    if (!formatSpec.has('Start') || !formatSpec.has('End')) {
      return rawAssContent;
    }

    const oldClipStartTime = clip.startTime;
    const oldClipDuration = clip.endTime - oldClipStartTime;
    const newClipDuration = newEndTime - newStartTime;

    if (oldClipDuration <= 0) return rawAssContent;

    const stretchFactor = newClipDuration / oldClipDuration;
    const lines = rawAssContent.split(/\r?\n/);
    const updatedLineIndexes = new Set<number>();

    for (const sourceSub of clip.sourceSubtitles) {
      if (sourceSub.type !== 'ass') continue;

      for (const part of sourceSub.parts) {
        let searchStartIndex = 0;
        let lineIndex = -1;
        do {
          lineIndex = this.findOriginalDialogueLineIndex(lines, formatSpec, {
            startTime: sourceSub.startTime,
            endTime: sourceSub.endTime,
            style: part.style,
            text: part.text,
          }, searchStartIndex);

          if (lineIndex !== -1 && !updatedLineIndexes.has(lineIndex)) {
            // Found a unique line, break the search loop for this part
            break;
          }

          if (lineIndex !== -1) {
            searchStartIndex = lineIndex + 1; // Prepare to search for the next duplicate if this one was already used
            lineIndex = -1; // Reset to not exit the do-while loop
          }
        } while (lineIndex !== -1 && updatedLineIndexes.has(lineIndex));


        if (lineIndex !== -1) {
          const oldSubStartTimeOffset = sourceSub.startTime - oldClipStartTime;
          const newSubStartTime = newStartTime + (oldSubStartTimeOffset * stretchFactor);
          const newSubEndTime = newStartTime + (oldSubStartTimeOffset * stretchFactor) + (sourceSub.endTime - sourceSub.startTime) * stretchFactor;

          const originalLine = lines[lineIndex];
          const lineParts = originalLine.split(',');
          lineParts[formatSpec.get('Start')!] = this.formatTime(newSubStartTime);
          lineParts[formatSpec.get('End')!] = this.formatTime(newSubEndTime);
          lines[lineIndex] = lineParts.join(',');

          updatedLineIndexes.add(lineIndex);
        }
      }
    }
    return lines.join('\r\n');
  }

  public updateClipText(
    clip: VideoClip,
    newContent: ClipContent,
    rawAssContent: string
  ): string {
    if (!newContent.parts || !clip.hasSubtitle || clip.sourceSubtitles.length === 0) {
      return rawAssContent;
    }

    const formatSpec = this.parseFormatLine(rawAssContent);
    if (!formatSpec.has('Style') || !formatSpec.has('Text')) {
      return rawAssContent;
    }

    const lines = rawAssContent.split(/\r?\n/);
    const originalUniqueParts = clip.parts;
    const updatedLineIndexes = new Set<number>();

    // Iterate through each unique part displayed in the dialog
    for (let i = 0; i < originalUniqueParts.length; i++) {
      const oldPart = originalUniqueParts[i];
      const newPart = newContent.parts[i];

      // If the text for this part was changed, find all lines that rendered it.
      if (oldPart.text !== newPart.text) {

        // Find every single dialogue line in the raw ASS file that matches the OLD part's criteria, and update it.
        let searchStartIndex = 0;
        let lineIndex = -1;

        // Loop until no more matches found
        do {
          lineIndex = this.findDialogueLineIndex(lines, formatSpec, {
            // Find lines based on the original, unedited text
            style: oldPart.style,
            text: oldPart.text,
          }, searchStartIndex);

          if (lineIndex !== -1) {
            // Check if line is already updated to avoid infinite loops on weird files
            if (updatedLineIndexes.has(lineIndex)) {
              searchStartIndex = lineIndex + 1;
              continue;
            }

            const originalLine = lines[lineIndex];
            const lineParts = originalLine.split(',');
            const textIndex = formatSpec.get('Text')!;
            const rawTextSegment = lineParts.slice(textIndex).join(',');

            // Reconstruct text part with new text
            const newTextSegment = this.reconstructTextSegment(rawTextSegment, oldPart.text, newPart.text);
            lineParts.splice(textIndex, lineParts.length - textIndex, newTextSegment);
            lines[lineIndex] = lineParts.join(',');

            // Mark this line as updated and continue searching from the next line
            updatedLineIndexes.add(lineIndex);
            searchStartIndex = lineIndex + 1;
          }
        } while (lineIndex !== -1);
      }
    }

    return lines.join('\r\n');
  }

  private findOriginalDialogueLineIndex(
    lines: string[],
    formatSpec: Map<string, number>,
    criteria: { startTime: number; endTime: number; style: string; text: string },
    startIndex: number = 0
  ): number {
    const textIndex = formatSpec.get('Text')!;
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().startsWith('dialogue:')) continue;

      const parts = line.split(',');
      if (parts.length <= textIndex) continue;

      const style = parts[formatSpec.get('Style')!];
      const start = parts[formatSpec.get('Start')!];
      const end = parts[formatSpec.get('End')!];
      const rawTextSegment = parts.slice(textIndex).join(',');
      const cleanTextFromFile = rawTextSegment.replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');

      if (
        style === criteria.style &&
        start === this.formatTime(criteria.startTime) &&
        end === this.formatTime(criteria.endTime) &&
        cleanTextFromFile === criteria.text
      ) {
        return i;
      }
    }
    return -1;
  }

  private findDialogueLineIndex(
    lines: string[],
    formatSpec: Map<string, number>,
    criteria: { style: string; text: string },
    startIndex: number = 0
  ): number {
    const textIndex = formatSpec.get('Text')!;
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().startsWith('dialogue:')) continue;

      const parts = line.split(',');
      if (parts.length <= textIndex) continue;

      const style = parts[formatSpec.get('Style')!];
      const rawTextSegment = parts.slice(textIndex).join(',');
      const cleanTextFromFile = rawTextSegment.replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');

      // Matching only on style and clean text content
      if (style === criteria.style && cleanTextFromFile === criteria.text) {
        return i;
      }
    }
    return -1;
  }

  private reconstructTextSegment(rawText: string, oldCleanText: string, newCleanText: string): string {
    const rawOldText = oldCleanText.replace(/\n/g, '\\N');
    const rawNewText = newCleanText.replace(/\n/g, '\\N');
    return rawText.replace(rawOldText, rawNewText);
  }

  private parseFormatLine(rawAssContent: string): Map<string, number> {
    const eventsMatch = rawAssContent.match(/\[Events\]\s*([\s\S]*?)(?=\s*\[|$)/i);
    if (!eventsMatch) return new Map();

    const formatLine = eventsMatch[1].split(/\r?\n/).find(line => line.toLowerCase().startsWith('format:'));
    if (!formatLine) return new Map();

    const parts = formatLine.substring('format:'.length).trim().split(',').map(p => p.trim());
    const spec = new Map<string, number>();
    parts.forEach((part, index) => {
      spec.set(part, index);
    });
    return spec;
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.round((seconds - Math.floor(seconds)) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}
