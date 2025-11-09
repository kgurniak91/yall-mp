import {Injectable} from '@angular/core';
import {VideoClip} from '../../../../model/video.types';
import {AssSubtitleData, SubtitlePart} from '../../../../../../shared/types/subtitle.type';
import {MIN_GAP_DURATION} from '../../../../state/clips/clips-state.service';
import {isEqual} from 'lodash-es';
import {ClipContent} from '../../../../model/commands/update-clip-text.command';
import {AssSubtitlesUtils} from '../../../../../../shared/utils/ass-subtitles.utils';

@Injectable()
export class AssEditService {

  public createNewDialogueLine(rawAssContent: string, subtitle: AssSubtitleData): string {
    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      console.error('Failed to parse ASS [Events] in addSubtitleToRawAss.');
      return rawAssContent;
    }

    const {header, formatLine, dialogueLines, formatSpec} = parsedEvents;

    const newDialogueLines = subtitle.parts.map(part => {
      const lineParts = new Array(formatSpec.size).fill('');

      // Set required fields
      lineParts[formatSpec.get('Start')!] = AssSubtitlesUtils.formatTime(subtitle.startTime);
      lineParts[formatSpec.get('End')!] = AssSubtitlesUtils.formatTime(subtitle.endTime);
      lineParts[formatSpec.get('Style')!] = part.style;
      lineParts[formatSpec.get('Text')!] = part.text.replace(/\n/g, '\\N');

      // Set common defaults for optional fields if they exist in the format
      if (formatSpec.has('Layer')) lineParts[formatSpec.get('Layer')!] = '0';
      if (formatSpec.has('Name')) lineParts[formatSpec.get('Name')!] = '';
      if (formatSpec.has('MarginL')) lineParts[formatSpec.get('MarginL')!] = '0';
      if (formatSpec.has('MarginR')) lineParts[formatSpec.get('MarginR')!] = '0';
      if (formatSpec.has('MarginV')) lineParts[formatSpec.get('MarginV')!] = '0';
      if (formatSpec.has('Effect')) lineParts[formatSpec.get('Effect')!] = '';

      return `Dialogue: ${lineParts.join(',')}`;
    });

    const allLines = [...dialogueLines, ...newDialogueLines].sort((a, b) => {
      const partsA = a.split(',');
      const partsB = b.split(',');
      const startTimeA = AssSubtitlesUtils.timeToSeconds(partsA[formatSpec.get('Start')!]);
      const startTimeB = AssSubtitlesUtils.timeToSeconds(partsB[formatSpec.get('Start')!]);
      return startTimeA - startTimeB;
    });

    return `${header}[Events]\n${formatLine}\n${allLines.join('\r\n')}`;
  }

  public removeDialogueLines(rawAssContent: string, clipToRemove: VideoClip): string {
    if (!clipToRemove.hasSubtitle) return rawAssContent;

    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      return rawAssContent;
    }

    const {header, formatLine, dialogueLines, formatSpec} = parsedEvents;
    const startIdx = formatSpec.get('Start')!;
    const endIdx = formatSpec.get('End')!;
    const styleIdx = formatSpec.get('Style')!;
    const textIdx = formatSpec.get('Text')!;

    const removalSignatures = new Set<string>();
    for (const sourceSub of clipToRemove.sourceSubtitles as AssSubtitleData[]) {
      for (const part of sourceSub.parts) {
        const signature = `${AssSubtitlesUtils.formatTime(sourceSub.startTime)},${AssSubtitlesUtils.formatTime(sourceSub.endTime)},${part.style},${part.text}`;
        removalSignatures.add(signature);
      }
    }

    const filteredLines = dialogueLines.filter(line => {
      const parts = line.split(',');
      if (parts.length <= Math.max(startIdx, endIdx, styleIdx, textIdx)) {
        return true; // Keep malformed lines
      }
      const lineStart = parts[startIdx];
      const lineEnd = parts[endIdx];
      const lineStyle = parts[styleIdx];
      const lineText = parts.slice(textIdx).join(',').replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');

      const lineSignature = `${lineStart},${lineEnd},${lineStyle},${lineText}`;

      return !removalSignatures.has(lineSignature);
    });

    return `${header}[Events]\n${formatLine}\n${filteredLines.join('\r\n')}`;
  }

  public mergeDialogueLines(rawAssContent: string, firstClip: VideoClip, secondClip: VideoClip): string {
    const allSourceSubs = [...firstClip.sourceSubtitles, ...secondClip.sourceSubtitles] as AssSubtitleData[];
    const gapStartTime = firstClip.endTime;
    const gapEndTime = secondClip.startTime;
    const midpoint = gapStartTime + ((gapEndTime - gapStartTime) / 2);

    const originalSubsToUpdate: AssSubtitleData[] = JSON.parse(JSON.stringify(allSourceSubs));
    const updatedSubsToUpdate: AssSubtitleData[] = JSON.parse(JSON.stringify(allSourceSubs));

    for (const sub of updatedSubsToUpdate) {
      if (firstClip.sourceSubtitles.some(s => s.id === sub.id)) {
        sub.endTime = midpoint;
      } else { // Belongs to secondClip
        sub.startTime = midpoint;
      }
    }

    return this.stretchClipTimings(originalSubsToUpdate, updatedSubsToUpdate, rawAssContent);
  }

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

  public modifyAssText(
    clip: VideoClip,
    newContent: ClipContent,
    rawAssContent: string
  ): string {
    if (!newContent.parts || !clip.hasSubtitle || clip.parts.length === 0) {
      return rawAssContent;
    }

    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      console.error('Failed to parse ASS [Events] in modifyAssText.');
      return rawAssContent;
    }
    const {formatSpec} = parsedEvents;
    const textIdx = formatSpec.get('Text');
    if (textIdx === undefined) {
      console.error("ASS 'Format' line is missing required fields.");
      return rawAssContent;
    }

    const edits = new Map<string, { oldPart: SubtitlePart, newPart: SubtitlePart }>();
    for (let i = 0; i < clip.parts.length; i++) {
      const oldPart = clip.parts[i];
      const newPart = newContent.parts[i];
      if (oldPart && newPart && !isEqual(oldPart, newPart)) {
        const key = `${oldPart.style}::${oldPart.text}`;
        edits.set(key, {oldPart, newPart});
      }
    }

    if (edits.size === 0) {
      return rawAssContent;
    }

    const lines = rawAssContent.split(/\r?\n/);
    const updatedLineIndexes = new Set<number>();

    const getLeafSubtitles = (sub: AssSubtitleData): AssSubtitleData[] => {
      if (sub.sourceDialogues && sub.sourceDialogues.length > 0) {
        return sub.sourceDialogues.flatMap(getLeafSubtitles);
      }
      return [sub];
    };

    const allSourceDialogues = (clip.sourceSubtitles as AssSubtitleData[]).flatMap(getLeafSubtitles);

    for (const sourceSub of allSourceDialogues) {
      for (const sourcePart of sourceSub.parts) {
        const lookupKey = `${sourcePart.style}::${sourcePart.text}`;
        const editInfo = edits.get(lookupKey);

        if (editInfo) {
          let searchStartIndex = 0;
          while (searchStartIndex < lines.length) {
            const lineIndex = this.findOriginalDialogueLineIndex(lines, formatSpec, {
              startTime: sourceSub.startTime,
              endTime: sourceSub.endTime,
              style: sourcePart.style,
              text: sourcePart.text,
            }, searchStartIndex);

            if (lineIndex === -1) {
              break;
            }

            if (updatedLineIndexes.has(lineIndex)) {
              searchStartIndex = lineIndex + 1;
              continue;
            }

            const lineToUpdate = lines[lineIndex];
            const parts = lineToUpdate.split(',');
            const rawTextSegment = parts.slice(textIdx).join(',');
            const {fragments: fragmentsFromFileLine} = AssSubtitlesUtils.parseDialogueTextToFragments(rawTextSegment);

            const newPart = editInfo.newPart;
            const newFragmentsFromModel = newPart.fragments || [];

            const finalFragments = [];
            let fileTagIndex = 0;

            if (newFragmentsFromModel.length > 0) {
              for (const newFrag of newFragmentsFromModel) {
                if (newFrag.isTag) {
                  let foundTag = false;
                  while (fileTagIndex < fragmentsFromFileLine.length) {
                    const fileFrag = fragmentsFromFileLine[fileTagIndex];
                    fileTagIndex++;
                    if (fileFrag.isTag) {
                      finalFragments.push(fileFrag);
                      foundTag = true;
                      break;
                    }
                  }
                  if (!foundTag) {
                    finalFragments.push(newFrag);
                  }
                } else {
                  finalFragments.push(newFrag);
                }
              }
            } else {
              fragmentsFromFileLine.forEach(frag => {
                if (frag.isTag) {
                  finalFragments.push(frag);
                }
              });
              finalFragments.push({text: newPart.text, isTag: false});
            }

            const newTextSegment = AssSubtitlesUtils.fragmentsToText(finalFragments);
            parts.splice(textIdx, parts.length - textIdx, newTextSegment);
            lines[lineIndex] = parts.join(',');
            updatedLineIndexes.add(lineIndex);

            searchStartIndex = lineIndex + 1;
          }
        }
      }
    }

    return lines.join('\r\n');
  }

  public splitDialogueLines(
    rawAssContent: string,
    originalSourceSubtitles: AssSubtitleData[],
    splitPoint: number,
    newSecondPartSubs: AssSubtitleData[]
  ): string {
    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) {
      console.error('Failed to parse ASS [Events] in splitDialogueLines.');
      return rawAssContent;
    }

    const {header, formatLine, formatSpec} = parsedEvents;
    let dialogueLines = [...parsedEvents.dialogueLines];
    const startIdx = formatSpec.get('Start')!;
    const endIdx = formatSpec.get('End')!;
    const originalDialogueLineIndexes = new Set<number>();

    // First, find all unique line indexes that belong to the original subtitles:
    for (const sourceSub of originalSourceSubtitles) {
      for (const part of sourceSub.parts) {
        let searchStartIndex = 0;
        while (searchStartIndex < dialogueLines.length) {
          const lineIndex = this.findOriginalDialogueLineIndex(
            dialogueLines,
            formatSpec,
            {startTime: sourceSub.startTime, endTime: sourceSub.endTime, style: part.style, text: part.text},
            searchStartIndex
          );
          if (lineIndex === -1) break;
          originalDialogueLineIndexes.add(lineIndex);
          searchStartIndex = lineIndex + 1;
        }
      }
    }

    const linesToAdd: string[] = [];
    const linesToModify: { index: number, newLine: string }[] = [];

    // Now, process only those unique lines:
    for (const lineIndex of Array.from(originalDialogueLineIndexes)) {
      const line = dialogueLines[lineIndex];
      const parts = line.split(',');
      const lineStartTime = AssSubtitlesUtils.timeToSeconds(parts[startIdx]);
      const lineEndTime = AssSubtitlesUtils.timeToSeconds(parts[endIdx]);

      // Only lines that cross the split point need to be physically split.
      if (lineStartTime < splitPoint && lineEndTime > splitPoint) {
        // Create the new line for the second part (truncated)
        const secondPartParts = [...parts];
        secondPartParts[startIdx] = AssSubtitlesUtils.formatTime(splitPoint + MIN_GAP_DURATION);
        secondPartParts[endIdx] = AssSubtitlesUtils.formatTime(lineEndTime);
        linesToAdd.push(secondPartParts.join(','));

        // Shorten the original line
        const firstPartParts = [...parts];
        firstPartParts[endIdx] = AssSubtitlesUtils.formatTime(splitPoint);
        linesToModify.push({index: lineIndex, newLine: firstPartParts.join(',')});
      }
    }

    // Apply modifications in reverse index order to avoid conflicts
    linesToModify.sort((a, b) => b.index - a.index).forEach(({index, newLine}) => {
      dialogueLines[index] = newLine;
    });

    // Add all the newly created line parts
    dialogueLines.push(...linesToAdd);

    // Re-sort all dialogue lines by their new start times
    dialogueLines.sort((a, b) => {
      const startTimeA = AssSubtitlesUtils.timeToSeconds(a.split(',')[startIdx]);
      const startTimeB = AssSubtitlesUtils.timeToSeconds(b.split(',')[startIdx]);
      return startTimeA - startTimeB;
    });

    return `${header}[Events]\n${formatLine}\n${dialogueLines.join('\r\n')}`;
  }

  public unsplitDialogueLines(
    rawAssContent: string,
    subtitlesToExtend: AssSubtitleData[],
    subtitlesToRemove: AssSubtitleData[],
    restoredFullSubtitles: AssSubtitleData[]
  ): string {
    const parsedEvents = AssSubtitlesUtils.parseEvents(rawAssContent);
    if (!parsedEvents) return rawAssContent;

    const {header, formatLine, dialogueLines, formatSpec} = parsedEvents;
    const endIdx = formatSpec.get('End')!;
    const textIdx = formatSpec.get('Text')!;
    const startIdx = formatSpec.get('Start')!;
    const styleIdx = formatSpec.get('Style')!;

    const removalSignatures = new Set<string>();
    for (const sub of subtitlesToRemove) {
      for (const part of sub.parts) {
        const signature = `${AssSubtitlesUtils.formatTime(sub.startTime)},${AssSubtitlesUtils.formatTime(sub.endTime)},${part.style},${part.text}`;
        removalSignatures.add(signature);
      }
    }

    const filteredLines = dialogueLines.filter(line => {
      const parts = line.split(',');
      const lineSignature = `${parts[startIdx]},${parts[endIdx]},${parts[styleIdx]},${parts.slice(textIdx).join(',').replace(/{[^}]*}/g, '').replace(/\\N/g, '\n')}`;
      return !removalSignatures.has(lineSignature);
    });

    const finalLines = filteredLines.map(line => {
      const lineParts = line.split(',');
      const lineStart = AssSubtitlesUtils.timeToSeconds(lineParts[startIdx]);
      const lineEnd = AssSubtitlesUtils.timeToSeconds(lineParts[endIdx]);
      const lineStyle = lineParts[styleIdx];
      const cleanText = lineParts.slice(textIdx).join(',').replace(/{[^}]*}/g, '').replace(/\\N/g, '\n');

      const subToExtend = subtitlesToExtend.find(s =>
        Math.abs(s.startTime - lineStart) < 0.01 &&
        Math.abs(s.endTime - lineEnd) < 0.01 &&
        s.parts.some(p => p.style === lineStyle && p.text === cleanText)
      );

      if (subToExtend) {
        const restoredSub = restoredFullSubtitles.find(rs => rs.id === subToExtend.id);
        if (restoredSub) {
          lineParts[endIdx] = AssSubtitlesUtils.formatTime(restoredSub.endTime);
          return lineParts.join(',');
        }
      }
      return line;
    });

    return `${header}[Events]\n${formatLine}\n${finalLines.join('\r\n')}`;
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

      const prefixEndIndex = line.indexOf(':') + 1;
      const data = line.substring(prefixEndIndex).trim();
      const parts = data.split(',');

      if (parts.length <= textIndex) continue;

      const style = parts[formatSpec.get('Style')!];
      const start = parts[formatSpec.get('Start')!];
      const end = parts[formatSpec.get('End')!];
      const rawTextSegment = parts.slice(textIndex).join(',');
      const {cleanText: cleanTextFromFile} = AssSubtitlesUtils.parseDialogueTextToFragments(rawTextSegment);
      const criteriaText = criteria.text.trim();

      if (
        style === criteria.style &&
        start === AssSubtitlesUtils.formatTime(criteria.startTime) &&
        end === AssSubtitlesUtils.formatTime(criteria.endTime) &&
        cleanTextFromFile === criteriaText
      ) {
        return i;
      }
    }
    return -1;
  }

}
