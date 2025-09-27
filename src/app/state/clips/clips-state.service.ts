import {computed, effect, inject, Injectable, OnDestroy, Signal, signal} from '@angular/core';
import {VideoStateService} from '../video/video-state.service';
import {PlayerState, SeekDirection, VideoClip} from '../../model/video.types';
import {CommandHistoryStateService} from '../command-history/command-history-state.service';
import {UpdateClipTimesCommand} from '../../model/commands/update-clip-times.command';
import {ToastService} from '../../shared/services/toast/toast.service';
import {SplitSubtitledClipCommand} from '../../model/commands/split-subtitled-clip.command';
import {MergeSubtitledClipsCommand} from '../../model/commands/merge-subtitled-clips.command';
import {AppStateService} from '../app/app-state.service';
import type {
  AssSubtitleData,
  SrtSubtitleData,
  SubtitleData,
  SubtitlePart
} from '../../../../shared/types/subtitle.type';
import {DeleteSubtitledClipCommand} from '../../model/commands/delete-subtitled-clip.command';
import {CreateSubtitledClipCommand} from '../../model/commands/create-subtitled-clip.command';
import {GlobalSettingsStateService} from '../global-settings/global-settings-state.service';
import {ClipContent} from '../../model/commands/update-clip-text.command';
import {AssEditService} from '../../features/project-details/services/ass-edit/ass-edit.service';

const MIN_CLIP_DURATION = 0.1;
const ADJUST_DEBOUNCE_MS = 50;
const NEW_GAP_DURATION = 0.1;
const MIN_SPLITTABLE_CLIP_DURATION = 0.5;
const FORCED_GAP_SECONDS = 0.05;
const MIN_SUBTITLE_DURATION = 0.5;

@Injectable()
export class ClipsStateService implements OnDestroy {
  private readonly videoStateService = inject(VideoStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly commandHistoryStateService = inject(CommandHistoryStateService);
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly assEditService = inject(AssEditService);
  private readonly _subtitles = signal<SubtitleData[]>([]);
  private readonly _currentClipIndex = signal(0);
  private readonly _playerState = signal<PlayerState>(PlayerState.Idle);
  private adjustDebounceTimer: any;
  private isInitialized = false;
  private _projectId: string | null = null;
  private readonly cleanupPlaybackListener: (() => void) | null = null;

  public readonly currentClipIndex = this._currentClipIndex.asReadonly();
  public readonly playerState = this._playerState.asReadonly();
  public readonly isPlaying = computed(() => this.playerState() === PlayerState.Playing);
  public readonly clips: Signal<VideoClip[]> = computed(() => this.generateClips());
  public readonly currentClip = computed<VideoClip | undefined>(() => {
    return this.clips()[this.currentClipIndex()];
  });

  constructor() {
    effect(() => {
      const currentClips = this.clips();
      if (currentClips.length > 0) {
        window.electronAPI.playbackUpdateClips(currentClips);
      }
    });

    effect(() => {
      const subtitles = this._subtitles();
      const projectId = this._projectId;

      if (!projectId || (subtitles.length === 0 && !this.isInitialized)) {
        return;
      }

      this.appStateService.updateProject(projectId, {subtitles});
    });

    this.cleanupPlaybackListener = window.electronAPI.onPlaybackStateUpdate((update) => {
      this.setPlayerState(update.playerState);
      this.setCurrentClipByIndex(update.currentClipIndex);
    });
  }

  ngOnDestroy(): void {
    if (this.cleanupPlaybackListener) {
      this.cleanupPlaybackListener();
    }
  }

  public setProjectId(id: string): void {
    this._projectId = id;
  }

  public setPlayerState(playerState: PlayerState): void {
    this._playerState.set(playerState);
  }

  public setSubtitles(subtitles: SubtitleData[]): void {
    this._subtitles.set(subtitles);
    this.isInitialized = true;
  }

  public setCurrentClipByIndex(index: number): void {
    if (index >= 0 && index < this.clips().length) {
      this._currentClipIndex.set(index);
    }
  }

  public splitCurrentSubtitledClip(): void {
    const currentClip = this.currentClip();

    if (!currentClip || !currentClip.hasSubtitle) {
      return;
    }

    if (currentClip.duration < MIN_SPLITTABLE_CLIP_DURATION) {
      this.toastService.warn(`Selected clip is too short to split. Minimum required duration is ${MIN_SPLITTABLE_CLIP_DURATION}s.`);
      return;
    }

    const command = new SplitSubtitledClipCommand(this, currentClip.id);
    this.commandHistoryStateService.execute(command);
  }

  public splitSubtitledClip(clipId: string, onSplitCallback?: (originalSubtitle: SubtitleData, newSubtitleId: string) => void): void {
    const originalSubtitleId = clipId.replace('subtitle-', '');
    const subtitles = this._subtitles();
    const subtitleIndex = subtitles.findIndex(c => c.id === originalSubtitleId);
    if (subtitleIndex === -1) return;

    const originalSubtitle = subtitles[subtitleIndex];

    const newId = crypto.randomUUID();
    onSplitCallback?.(JSON.parse(JSON.stringify(originalSubtitle)), newId);

    const splitPoint = originalSubtitle.startTime + ((originalSubtitle.endTime - originalSubtitle.startTime) / 2);
    const newSubtitles = [...subtitles];

    let secondPartSubtitle: SubtitleData;

    if (originalSubtitle.type === 'ass') {
      secondPartSubtitle = {
        type: 'ass',
        id: newId,
        startTime: splitPoint + NEW_GAP_DURATION,
        endTime: originalSubtitle.endTime,
        parts: JSON.parse(JSON.stringify(originalSubtitle.parts))
      };
    } else { // 'srt'
      secondPartSubtitle = {
        type: 'srt',
        id: newId,
        startTime: splitPoint + NEW_GAP_DURATION,
        endTime: originalSubtitle.endTime,
        text: originalSubtitle.text
      };
    }

    originalSubtitle.endTime = splitPoint;

    newSubtitles.splice(subtitleIndex + 1, 0, secondPartSubtitle);
    this._subtitles.set(newSubtitles);
  }

  public unsplitClip(originalSubtitle: SubtitleData, secondSubtitleId: string): void {
    const subtitles = this._subtitles();

    // Find the index of the first part of the split.
    const firstPartIndex = subtitles.findIndex(s => s.id === originalSubtitle.id);
    if (firstPartIndex === -1) {
      console.error("Cannot undo split: first part of the clip not found.");
      return;
    }

    const newSubtitles = [...subtitles];

    // Replace the modified first part with the saved original state.
    newSubtitles[firstPartIndex] = originalSubtitle;

    // Filter out the second part that was created during the split.
    const restoredSubtitles = newSubtitles.filter(s => s.id !== secondSubtitleId);

    this._subtitles.set(restoredSubtitles);
  }

  public deleteCurrentClip(): void {
    const currentClip = this.currentClip();
    if (!currentClip) return;

    if (currentClip.hasSubtitle) {
      const subtitleId = currentClip.id.replace('subtitle-', '');
      const command = new DeleteSubtitledClipCommand(this, subtitleId);
      this.commandHistoryStateService.execute(command);
    } else {
      const clips = this.clips();
      const currentIndex = this.currentClipIndex();
      const prevClip = clips[currentIndex - 1];
      const nextClip = clips[currentIndex + 1];

      if (!prevClip || !nextClip || !prevClip.hasSubtitle || !nextClip.hasSubtitle) {
        this.toastService.warn('Cannot delete a gap at the beginning or end of the timeline.');
        return;
      }

      const command = new MergeSubtitledClipsCommand(this, prevClip.id, nextClip.id);
      this.commandHistoryStateService.execute(command);
    }
  }

  public mergeClips(
    firstClipId: string,
    secondClipId: string,
    onMergeCallback?: (originalFirstSubtitle: SubtitleData, deletedSecondSubtitle: SubtitleData) => void,
    newText?: string
  ): void {
    const timeBeforeDelete = this.videoStateService.currentTime();
    const firstSubtitleId = firstClipId.replace('subtitle-', '');
    const secondSubtitleId = secondClipId.replace('subtitle-', '');
    const subtitles = this._subtitles();
    const firstSubtitleIndex = subtitles.findIndex(c => c.id === firstSubtitleId);
    const secondSubtitleIndex = subtitles.findIndex(c => c.id === secondSubtitleId);

    if (firstSubtitleIndex === -1 || secondSubtitleIndex === -1) {
      return;
    }

    const newSubtitles = [...subtitles];
    const firstSubtitle = newSubtitles[firstSubtitleIndex];
    const secondSubtitle = newSubtitles[secondSubtitleIndex];

    // The callback provides the original data to the command for its undo state
    onMergeCallback?.(firstSubtitle, secondSubtitle);

    // Perform the merge
    firstSubtitle.endTime = secondSubtitle.endTime;

    if (firstSubtitle.type === 'srt' && secondSubtitle.type === 'srt') {
      if (newText !== undefined) {
        firstSubtitle.text = newText;
      } else {
        firstSubtitle.text += `\n${secondSubtitle.text}`;
      }
    } else if (firstSubtitle.type === 'ass' && secondSubtitle.type === 'ass') {
      const combinedParts = [...firstSubtitle.parts, ...secondSubtitle.parts];

      const uniquePartsMap = new Map<string, SubtitlePart>();
      for (const part of combinedParts) {
        const key = `${part.style}::${part.text}`;
        uniquePartsMap.set(key, part);
      }

      firstSubtitle.parts = Array.from(uniquePartsMap.values());
    }

    newSubtitles.splice(secondSubtitleIndex, 1);
    this._subtitles.set(newSubtitles);

    // Re-synchronize the active clip index:
    const newClipsArray = this.clips();

    const newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._currentClipIndex.set(newCorrectIndex);
    }
  }

  public unmergeClips(
    originalFirstSubtitle: SubtitleData,
    secondSubtitleToRestore: SubtitleData
  ): void {
    const subtitles = this._subtitles();
    const firstSubtitleIndex = subtitles.findIndex(c => c.id === originalFirstSubtitle.id);
    if (firstSubtitleIndex === -1) return;

    const newSubtitles = [...subtitles];

    newSubtitles[firstSubtitleIndex] = originalFirstSubtitle;
    newSubtitles.splice(firstSubtitleIndex + 1, 0, secondSubtitleToRestore);

    this._subtitles.set(newSubtitles);
  }

  public createNewSubtitledClipAtCurrentTime(): void {
    const currentClip = this.currentClip();

    // Must be in a gap:
    if (!currentClip || currentClip.hasSubtitle) {
      this.toastService.info('A new subtitle can only be added inside a gap.');
      return;
    }

    // The gap must be large enough for the new subtitle and its surrounding gaps.
    const minimumRequiredSpace = MIN_SUBTITLE_DURATION + (2 * FORCED_GAP_SECONDS);
    if (currentClip.duration < minimumRequiredSpace) {
      this.toastService.warn(`This gap is too small to add a new subtitle. Minimum space required: ${minimumRequiredSpace.toFixed(2)}s`);
      return;
    }

    // Define boundaries for the new subtitle
    let newStartTime = this.videoStateService.currentTime();
    let newEndTime = newStartTime + MIN_SUBTITLE_DURATION;

    // Ensure the new subtitle respects the required gaps within the current gap.
    const earliestPossibleStart = currentClip.startTime + FORCED_GAP_SECONDS;
    const latestPossibleEnd = currentClip.endTime - FORCED_GAP_SECONDS;

    // Adjust start time if the user's cursor is too close to the beginning
    if (newStartTime < earliestPossibleStart) {
      newStartTime = earliestPossibleStart;
      newEndTime = newStartTime + MIN_SUBTITLE_DURATION;
    }

    // Final check: Does the new clip, after potential adjustments, still fit?
    if (newEndTime > latestPossibleEnd) {
      this.toastService.warn('Not enough space to add a new subtitle at this exact time.');
      return;
    }

    const newSubtitle: SubtitleData = {
      type: 'srt',
      id: crypto.randomUUID(),
      startTime: newStartTime,
      endTime: newEndTime,
      text: 'New Subtitle' // Placeholder text
    };

    const command = new CreateSubtitledClipCommand(this, newSubtitle);
    this.commandHistoryStateService.execute(command);

    // Seek to the start of the new clip for immediate feedback
    this.videoStateService.seekAbsolute(newStartTime);
  }

  public addSubtitle(subtitle: SubtitleData): void {
    const currentSubtitles = this._subtitles();

    const insertIndex = currentSubtitles.findIndex(s => s.startTime > subtitle.startTime);

    const newSubtitles = [...currentSubtitles];

    if (insertIndex === -1) {
      // If no subtitle starts after the new one, add it to the end
      newSubtitles.push(subtitle);
    } else {
      newSubtitles.splice(insertIndex, 0, subtitle);
    }

    this._subtitles.set(newSubtitles);
  }

  public deleteSubtitle(subtitleId: string): { deletedSubtitle: SubtitleData, originalIndex: number } | null {
    const subtitles = this._subtitles();
    const indexToDelete = subtitles.findIndex(s => s.id === subtitleId);

    if (indexToDelete === -1) {
      return null;
    }

    const timeBeforeDelete = this.videoStateService.currentTime();
    const deletedSubtitle = subtitles[indexToDelete];
    const newSubtitles = [...subtitles];
    newSubtitles.splice(indexToDelete, 1);

    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clips();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._currentClipIndex.set(newCorrectIndex);
    }

    return {deletedSubtitle, originalIndex: indexToDelete};
  }

  public insertSubtitle(subtitle: SubtitleData, index: number): void {
    const newSubtitles = [...this._subtitles()];
    newSubtitles.splice(index, 0, subtitle);
    this._subtitles.set(newSubtitles);
  }

  public updateClipText(projectId: string, clip: VideoClip, newContent: ClipContent): void {
    const project = this.appStateService.getProjectById(projectId);

    if (project?.rawAssContent && newContent.parts) {
      const newRawAssContent = this.assEditService.updateClipText(
        clip,
        newContent,
        project.rawAssContent
      );
      this.appStateService.updateProject(projectId, {rawAssContent: newRawAssContent});

      const newSubtitles = [...this._subtitles()];

      // For each part that was edited in the UI...
      for (let i = 0; i < clip.parts.length; i++) {
        const oldPart = clip.parts[i];
        const newPart = newContent.parts[i];

        if (oldPart.text !== newPart.text) {
          // ...find EVERY subtitle object in the entire project that contains the old part...
          for (let j = 0; j < newSubtitles.length; j++) {
            const subtitle = newSubtitles[j];
            if (subtitle.type === 'ass') {
              const partIndex = subtitle.parts.findIndex(p => p.style === oldPart.style && p.text === oldPart.text);
              if (partIndex !== -1) {
                // ...and update it with the new part:
                const updatedParts = [...subtitle.parts];
                updatedParts[partIndex] = newPart;
                (newSubtitles[j] as AssSubtitleData).parts = updatedParts;
              }
            }
          }
        }
      }
      this._subtitles.set(newSubtitles);
    } else if (newContent.text !== undefined) {
      const newSubtitles = [...this._subtitles()];
      const sourceSub = clip.sourceSubtitles[0];
      if (sourceSub) {
        const subIndex = newSubtitles.findIndex(s => s.id === sourceSub.id);
        if (subIndex !== -1) {
          (newSubtitles[subIndex] as SrtSubtitleData).text = newContent.text;
          this._subtitles.set(newSubtitles);
        }
      }
    }
  }

  public advanceToNextClip(): void {
    const nextIndex = this.currentClipIndex() + 1;
    if (nextIndex < this.clips().length) {
      this._currentClipIndex.set(nextIndex);
    } else {
      this._playerState.set(PlayerState.Idle); // Reached the end
    }
  }

  public goToAdjacentSubtitledClip(direction: SeekDirection): void {
    const adjacentClip = this.findAdjacentSubtitledClip(direction);
    if (adjacentClip) {
      this.videoStateService.seekAbsolute(adjacentClip.startTime);
    } else if (direction === SeekDirection.Previous) {
      const current = this.currentClip();
      if (current?.hasSubtitle) {
        this.videoStateService.seekAbsolute(current.startTime);
      }
    }
  }

  public updateClipTimes(sourceSubtitleIds: string[], newStartTime: number, newEndTime: number): void {
    const allClips = this.clips();
    const clipToUpdate = allClips.find(c => c.sourceSubtitles.some(s => sourceSubtitleIds.includes(s.id)));
    const project = this.appStateService.getProjectById(this._projectId!);

    if (!clipToUpdate || !project) {
      console.error('Cannot update clip times: Clip or Project not found.');
      return;
    }

    if (clipToUpdate.hasSubtitle && clipToUpdate.sourceSubtitles[0]?.type === 'ass' && project.rawAssContent) {
      const newRawAssContent = this.assEditService.stretchClipTimings(
        clipToUpdate,
        newStartTime,
        newEndTime,
        project.rawAssContent
      );
      this.appStateService.updateProject(project.id, {rawAssContent: newRawAssContent});
    }

    const currentActiveIndex = this.currentClipIndex();
    const activeClipBeforeUpdate = allClips[currentActiveIndex];

    if (!activeClipBeforeUpdate) {
      return;
    }

    const clipBeingEditedIndex = allClips.findIndex(c => c.id === clipToUpdate.id);
    if (this.playerState() === PlayerState.AutoPausedAtEnd && currentActiveIndex === clipBeingEditedIndex) {
      this.setPlayerState(PlayerState.PausedByUser);
    }

    const currentTime = this.videoStateService.currentTime();
    const updatedClips = this.calculateUpdatedClips(allClips, clipToUpdate.id, newStartTime, newEndTime);
    const activeClipAfterUpdate = updatedClips[currentActiveIndex];

    const boundaryMovedLeftPastPlayhead = (activeClipAfterUpdate.startTime > activeClipBeforeUpdate.startTime) && (currentTime < activeClipAfterUpdate.startTime);
    const boundaryMovedRightPastPlayPlayhead = (activeClipAfterUpdate.endTime < activeClipBeforeUpdate.endTime) && (currentTime >= activeClipAfterUpdate.endTime);

    if (boundaryMovedLeftPastPlayhead || boundaryMovedRightPastPlayPlayhead) {
      const newCorrectIndex = updatedClips.findIndex(c => currentTime >= c.startTime && currentTime < c.endTime);
      if (newCorrectIndex !== -1 && newCorrectIndex !== currentActiveIndex) {
        this.setCurrentClipByIndex(newCorrectIndex);
      }
    }

    this.updateSubtitlesFromClips(updatedClips);
  }

  public updateClipTimesFromTimeline(clipId: string, newStartTime: number, newEndTime: number): void {
    const clipToUpdate = this.clips().find(c => c.id === clipId);

    if (!clipToUpdate) {
      console.error(`Cannot update times for clip ID ${clipId}: Clip not found.`);
      return;
    }

    const command = new UpdateClipTimesCommand(
      this,
      clipToUpdate.sourceSubtitles.map(s => s.id),
      clipToUpdate.startTime,
      clipToUpdate.endTime,
      newStartTime,
      newEndTime
    );

    this.commandHistoryStateService.execute(command);
  }

  public adjustCurrentClipBoundary(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    clearTimeout(this.adjustDebounceTimer);

    this.adjustDebounceTimer = setTimeout(() => {
      this.performAdjust(boundary, direction);
    }, ADJUST_DEBOUNCE_MS);
  }

  private performAdjust(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    const currentClip = this.currentClip();
    if (!currentClip) {
      return;
    }

    const currentClipIndex = this.currentClipIndex();
    const totalClips = this.clips().length;

    if (currentClipIndex === 0 && boundary === 'start') {
      return;
    }

    if (currentClipIndex === (totalClips - 1) && boundary === 'end') {
      return;
    }

    const adjustAmountSeconds = this.globalSettingsStateService.boundaryAdjustAmountMs() / 1000;
    const directionMultiplier = (direction === 'left') ? -1 : 1;
    const changeAmount = adjustAmountSeconds * directionMultiplier;

    let newStartTime = currentClip.startTime;
    let newEndTime = currentClip.endTime;

    if (boundary === 'start') {
      newStartTime += changeAmount;
    } else { // boundary === 'end'
      newEndTime += changeAmount;
    }

    if (newStartTime < 0) {
      newStartTime = 0;
    }

    const totalDuration = this.videoStateService.duration();
    if (newEndTime > totalDuration) {
      newEndTime = totalDuration;
    }

    if (newStartTime > newEndTime) {
      newStartTime = newEndTime;
    }

    const currentTime = this.videoStateService.currentTime();

    // If moving the start boundary to the right would pass the playhead...
    if (boundary === 'start' && newStartTime > currentTime) {
      // ...anchor the playhead to the new, sanitized start time.
      this.videoStateService.seekAbsolute(newStartTime + 0.01);
    }

    // If moving the end boundary to the left would pass the playhead...
    if (boundary === 'end' && newEndTime < currentTime) {
      // ...anchor the playhead to the new, sanitized end time.
      this.videoStateService.seekAbsolute(newEndTime - 0.01);
    }

    const command = new UpdateClipTimesCommand(
      this, // ClipsStateService instance
      currentClip.sourceSubtitles.map(s => s.id),
      currentClip.startTime,
      currentClip.endTime,
      newStartTime,
      newEndTime
    );

    this.commandHistoryStateService.execute(command);
  }

  private findAdjacentSubtitledClip(direction: SeekDirection): VideoClip | undefined {
    const clips = this.clips();
    if (clips.length === 0) {
      return undefined;
    }

    const currentIndex = this.currentClipIndex();
    const referenceClip = clips[currentIndex];
    if (!referenceClip) {
      return undefined;
    }

    if (direction === SeekDirection.Next) {
      for (let i = currentIndex + 1; i < clips.length; i++) {
        if (clips[i].hasSubtitle) {
          return clips[i];
        }
      }
      return undefined; // No next subtitle clip found
    }

    if (direction === SeekDirection.Previous) {
      // find the index of the PREVIOUS subtitle clip by searching backwards.
      let previousSubtitleIndex = -1;
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (clips[i].hasSubtitle) {
          previousSubtitleIndex = i;
          break;
        }
      }

      // If there is no previous subtitle clip, the player is at the start.
      // In this case, the target is the current clip.
      if (previousSubtitleIndex === -1) {
        const currentClip = clips[currentIndex];
        // Only return the current clip if it has a subtitle.
        return currentClip?.hasSubtitle ? currentClip : undefined;
      }

      // Otherwise, return the found previous subtitle clip.
      return clips[previousSubtitleIndex];
    }

    return undefined; // No adjacent subtitle clip was found
  }

  private updateSubtitlesFromClips(updatedClips: VideoClip[]): void {
    const currentSubtitles = this._subtitles();
    const subtitleIdToClipMap = new Map<string, VideoClip>();

    updatedClips
      .filter(clip => clip.hasSubtitle)
      .forEach(clip => {
        clip.sourceSubtitles.forEach(sourceSub => {
          subtitleIdToClipMap.set(sourceSub.id, clip);
        });
      });

    const newSubtitles = currentSubtitles.map(subtitle => {
      const updatedClip = subtitleIdToClipMap.get(subtitle.id);
      if (updatedClip) {
        return {
          ...subtitle,
          startTime: updatedClip.startTime,
          endTime: updatedClip.endTime,
        };
      } else {
        return subtitle;
      }
    });

    this._subtitles.set(newSubtitles);
  }

  private generateClips(): VideoClip[] {
    const subtitles = this._subtitles();
    const duration = this.videoStateService.duration();
    if (!duration) return [];

    if (subtitles.length === 0) {
      return [{
        id: 'gap-only', startTime: 0, endTime: duration, duration, hasSubtitle: false,
        parts: [], sourceSubtitles: []
      }];
    }

    // Get all unique timestamps that define segment boundaries
    const timestamps = new Set<number>([0]);
    subtitles.forEach(s => {
      timestamps.add(s.startTime);
      timestamps.add(s.endTime);
    });
    timestamps.add(duration);
    const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b).filter(t => t <= duration);

    const segments: Partial<VideoClip>[] = [];

    // Create a raw segment for each time slice
    for (let i = 0; i < sortedTimestamps.length - 1; i++) {
      const startTime = sortedTimestamps[i];
      const endTime = sortedTimestamps[i + 1];

      if (endTime <= startTime) continue;

      const midPoint = startTime + 0.001;
      const activeSubtitles = subtitles.filter(s => midPoint >= s.startTime && midPoint < s.endTime);

      segments.push({
        startTime,
        endTime,
        hasSubtitle: activeSubtitles.length > 0,
        sourceSubtitles: activeSubtitles
      });
    }

    // Merge adjacent segments that have the exact same set of active subtitles
    const mergedSegments: VideoClip[] = [];
    if (segments.length > 0) {
      let currentSegment = {...segments[0]};

      for (let i = 1; i < segments.length; i++) {
        const nextSegment = segments[i];

        const getCurrentKey = (seg: Partial<VideoClip>): string => {
          if (!seg.hasSubtitle || !seg.sourceSubtitles || seg.sourceSubtitles.length === 0) return 'gap';
          const uniqueParts = new Map<string, SubtitlePart>();
          seg.sourceSubtitles.forEach(s => {
            if (s.type === 'ass') s.parts.forEach(p => uniqueParts.set(`${p.style}::${p.text}`, p));
          });
          const sortedParts = Array.from(uniqueParts.values()).sort((a, b) => a.style.localeCompare(b.style) || a.text.localeCompare(b.text));
          return JSON.stringify(sortedParts);
        };

        const currentKey = getCurrentKey(currentSegment);
        const nextKey = getCurrentKey(nextSegment);

        if (currentKey === nextKey) {
          // If visual content is identical, extend current segment
          currentSegment.endTime = nextSegment.endTime;

          // Create Set of existing IDs to avoid duplicates
          const existingIds = new Set(currentSegment.sourceSubtitles!.map(s => s.id));
          // Add new source subtitles from next segment
          nextSegment.sourceSubtitles!.forEach(sub => {
            if (!existingIds.has(sub.id)) {
              currentSegment.sourceSubtitles!.push(sub);
            }
          });

        } else {
          // If content changes, push completed segment and start new one
          mergedSegments.push(currentSegment as VideoClip);
          currentSegment = {...nextSegment};
        }
      }
      mergedSegments.push(currentSegment as VideoClip);
    }

    // Finalize all clips, including gaps
    const finalClips = mergedSegments.map(clip => {
      // Finalize a subtitle clip
      if (clip.hasSubtitle) {
        const uniquePartsMap = new Map<string, SubtitlePart>();
        clip.sourceSubtitles!.forEach(s => {
          if (s.type === 'ass') {
            s.parts.forEach(part => {
              const key = `${part.style}::${part.text}`;
              if (!uniquePartsMap.has(key)) {
                uniquePartsMap.set(key, part);
              }
            });
          }
        });

        return {
          ...clip,
          id: `subtitle-${clip.startTime}`,
          duration: clip.endTime! - clip.startTime!,
          parts: Array.from(uniquePartsMap.values()),
          text: clip.sourceSubtitles!
            .filter(s => s.type === 'srt')
            .map(s => (s as SrtSubtitleData).text).join('\n')
        } as VideoClip;
      }

      // Finalize a gap clip
      return {
        ...clip,
        id: `gap-${clip.startTime}`,
        duration: clip.endTime! - clip.startTime!,
        parts: [],
        sourceSubtitles: []
      } as VideoClip;
    });

    // Filter out any zero-duration clips that might have been created
    return finalClips.filter(c => c.duration > 0.01);
  }

  private calculateUpdatedClips(
    originalClips: VideoClip[],
    clipId: string,
    newStartTime: number,
    newEndTime: number
  ): VideoClip[] {
    const clipIndex = originalClips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) {
      return originalClips;
    }

    const updatedClips: VideoClip[] = JSON.parse(JSON.stringify(originalClips));

    let finalStartTime = newStartTime;
    let finalEndTime = newEndTime;

    const targetClip = updatedClips[clipIndex];
    const oldStartTime = targetClip.startTime;
    const oldEndTime = targetClip.endTime;

    if (oldStartTime.toFixed(4) !== finalStartTime.toFixed(4)) {
      const prevClip = updatedClips[clipIndex - 1];
      if (prevClip) {
        if (finalStartTime < prevClip.startTime + MIN_CLIP_DURATION) {
          finalStartTime = prevClip.startTime + MIN_CLIP_DURATION;
        }
        prevClip.endTime = finalStartTime;
      } else {
        if (finalStartTime < 0) {
          finalStartTime = 0;
        }
      }
    }

    if (oldEndTime.toFixed(4) !== finalEndTime.toFixed(4)) {
      const nextClip = updatedClips[clipIndex + 1];
      if (nextClip) {
        if (finalEndTime > nextClip.endTime - MIN_CLIP_DURATION) {
          finalEndTime = nextClip.endTime - MIN_CLIP_DURATION;
        }
        nextClip.startTime = finalEndTime;
      } else {
        const duration = this.videoStateService.duration();
        if (finalEndTime > duration) {
          finalEndTime = duration;
        }
      }
    }

    if (finalEndTime < finalStartTime + MIN_CLIP_DURATION) {
      finalEndTime = finalStartTime + MIN_CLIP_DURATION;
    }

    targetClip.startTime = finalStartTime;
    targetClip.endTime = finalEndTime;

    [clipIndex - 1, clipIndex, clipIndex + 1].forEach(idx => {
      if (updatedClips[idx]) {
        updatedClips[idx].duration = updatedClips[idx].endTime - updatedClips[idx].startTime;
      }
    });

    return updatedClips;
  }
}
