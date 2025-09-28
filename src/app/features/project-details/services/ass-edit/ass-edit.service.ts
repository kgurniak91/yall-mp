import {Injectable} from '@angular/core';
import {VideoClip} from '../../../../model/video.types';
import {ClipContent} from '../../../../model/commands/update-clip-text.command';
import {AssSubtitlesUtils} from '../../../../shared/utils/ass-subtitles/ass-subtitles.utils';
import {AssSubtitleData, SubtitlePart} from '../../../../../../shared/types/subtitle.type';

@Injectable()
export class AssEditService {

  public stretchClipTimings(
    originalSourceSubtitles: AssSubtitleData[],
    updatedSourceSubtitles: AssSubtitleData[],
    rawAssContent: string
  ): string {
    if (originalSourceSubtitles.length === 0 || originalSourceSubtitles.length !== updatedSourceSubtitles.length) {
      console.warn('stretchClipTimings received empty or mismatched subtitle arrays.');
      return rawAssContent;
    }

    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      console.error('Failed to parse ASS [Events] in stretchClipTimings.');
      return rawAssContent;
    }

    const {formatSpec} = parsedEvents;
    const startIdx = formatSpec.get('Start');
    const endIdx = formatSpec.get('End');
    if (startIdx === undefined || endIdx === undefined) {
      return rawAssContent;
    }

    const lines = rawAssContent.split(/\r?\n/);
    const updatedLineIndexes = new Set<number>();

    for (let i = 0; i < originalSourceSubtitles.length; i++) {
      const originalSub = originalSourceSubtitles[i];
      const updatedSub = updatedSourceSubtitles[i];

      for (const part of originalSub.parts) {
        let searchStartIndex = 0;

        while (searchStartIndex < lines.length) {
          const lineIndex = this.findOriginalDialogueLineIndex(lines, formatSpec, {
            startTime: originalSub.startTime,
            endTime: originalSub.endTime,
            style: part.style,
            text: part.text,
          }, searchStartIndex);

          if (lineIndex === -1) {
            break;
          }

          if (!updatedLineIndexes.has(lineIndex)) {
            const lineParts = lines[lineIndex].split(',');
            lineParts[startIdx] = AssSubtitlesUtils.formatTime(updatedSub.startTime);
            lineParts[endIdx] = AssSubtitlesUtils.formatTime(updatedSub.endTime);
            lines[lineIndex] = lineParts.join(',');
            updatedLineIndexes.add(lineIndex);
          }

          searchStartIndex = lineIndex + 1;
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
    if (!newContent.parts || !clip.hasSubtitle || clip.parts.length === 0) {
      return rawAssContent;
    }

    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      console.error('Failed to parse ASS [Events] in updateClipText.');
      return rawAssContent;
    }
    const {formatSpec} = parsedEvents;

    const startIdx = formatSpec.get('Start');
    const endIdx = formatSpec.get('End');
    const styleIdx = formatSpec.get('Style');
    const textIdx = formatSpec.get('Text');

    if (startIdx === undefined || endIdx === undefined || styleIdx === undefined || textIdx === undefined) {
      console.error("ASS 'Format' line is missing required fields.");
      return rawAssContent;
    }

    const editsMap = new Map<string, SubtitlePart>();
    for (let i = 0; i < clip.parts.length; i++) {
      const oldPart = clip.parts[i];
      const newPart = newContent.parts[i];
      if (oldPart.text !== newPart.text) {
        editsMap.set(oldPart.text, newPart);
      }
    }

    if (editsMap.size === 0) {
      return rawAssContent;
    }

    const lines = rawAssContent.split(/\r?\n/);
    const updatedLines = lines.map(line => {
      if (!line.toLowerCase().startsWith('dialogue:')) {
        return line;
      }

      const parts = line.split(',');
      if (parts.length <= Math.max(startIdx, endIdx, styleIdx, textIdx)) {
        return line;
      }

      const lineStartTime = AssSubtitlesUtils.timeToSeconds(parts[startIdx]);
      const lineEndTime = AssSubtitlesUtils.timeToSeconds(parts[endIdx]);
      const isTimeOverlap = lineStartTime < clip.endTime && lineEndTime > clip.startTime;

      if (!isTimeOverlap) {
        return line;
      }

      const rawTextSegment = parts.slice(textIdx).join(',');
      const cleanText = rawTextSegment.replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');
      const newPart = editsMap.get(cleanText);
      const lineStyle = parts[styleIdx];

      if (newPart && newPart.style === lineStyle) {
        const newTextSegment = this.reconstructTextSegment(rawTextSegment, newPart);
        parts.splice(textIdx, parts.length - textIdx, newTextSegment);
        return parts.join(',');
      } else {
        return line;
      }
    });

    return updatedLines.join('\r\n');
  }

  private reconstructTextSegment(
    originalRawText: string,
    newPart: SubtitlePart
  ): string {
    const getTextFromFragments = (p: SubtitlePart) =>
      p.fragments?.filter(f => !f.isTag).map(f => f.text).join('') ?? p.text;

    // Determine if the original line was a simple animation (all tags at the start).
    const textWithoutLeadingTags = originalRawText.replace(/^({[^}]*})+/, '');
    const wasSimpleAnimation = !textWithoutLeadingTags.includes('{');

    if (wasSimpleAnimation) {
      // It's a simple animation line. Preserve its unique leading tags.
      // Then, append the new clean text content (derived from the new part).
      const tagBlockMatch = originalRawText.match(/^({[^}]*})+/);
      const leadingTags = tagBlockMatch ? tagBlockMatch[0] : '';
      const newText = getTextFromFragments(newPart).replace(/\n/g, '\\N');
      return leadingTags + newText;
    } else {
      // It's a line with complex inline styling.
      // The new fragments from the UI are the absolute source of truth for the entire segment.
      if (newPart.fragments && newPart.fragments.length > 0) {
        return newPart.fragments.map(f => f.text.replace(/\n/g, '\\N')).join('');
      } else {
        // Fallback: If for some reason there is a complex line but no new fragments,
        // just append the new text to preserve the original leading tags. This may not be perfect.
        const lastTagIndex = originalRawText.lastIndexOf('}');
        const tags = lastTagIndex === -1 ? '' : originalRawText.substring(0, lastTagIndex + 1);
        const newText = newPart.text.replace(/\n/g, '\\N');
        return tags + newText;
      }
    }
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
        start === AssSubtitlesUtils.formatTime(criteria.startTime) &&
        end === AssSubtitlesUtils.formatTime(criteria.endTime) &&
        cleanTextFromFile === criteria.text
      ) {
        return i;
      }
    }
    return -1;
  }

}
