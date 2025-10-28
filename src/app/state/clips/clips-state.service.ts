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
import {Project} from '../../model/project.types';
import {AssSubtitlesUtils} from '../../shared/utils/ass-subtitles/ass-subtitles.utils';
import {cloneDeep} from 'lodash-es';
import {v4 as uuidv4} from 'uuid';

export const ADJUST_DEBOUNCE_MS = 50;
export const MIN_GAP_DURATION = 0.1;
export const MIN_SUBTITLE_DURATION = 0.5;

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
  }

  public getSubtitles(): SubtitleData[] {
    return this._subtitles();
  }

  public restoreSubtitles(originalSubtitles: SubtitleData[], originalRawAssContent?: string): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) {
      return;
    }

    const updates: Partial<Project> = {subtitles: originalSubtitles};

    if (originalRawAssContent) {
      updates.rawAssContent = originalRawAssContent;
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(originalSubtitles);

    // Re-sync active clip after undo
    const currentTime = this.videoStateService.currentTime();
    const newClipsArray = this.clips();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      currentTime >= c.startTime && currentTime < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this.setCurrentClipByIndex(newCorrectIndex);
    }
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

    // A valid split requires space for two minimum-length subtitle clips and one minimum-length gap:
    const minimumRequiredDuration = (MIN_SUBTITLE_DURATION * 2) + MIN_GAP_DURATION;

    if (currentClip.duration < minimumRequiredDuration) {
      this.toastService.warn(`Selected clip is too short to split. Minimum required duration is ${minimumRequiredDuration.toFixed(1)}s.`);
      return;
    }

    const project = this.appStateService.getProjectById(this._projectId!);
    const command = new SplitSubtitledClipCommand(this, currentClip.id, project?.rawAssContent);
    this.commandHistoryStateService.execute(command);
  }

  public splitSubtitledClip(clipId: string, onSplitCallback?: (originalSubtitles: SubtitleData[], createdAndModifiedIds: string[]) => void): void {
    const clipToSplit = this.clips().find(c => c.id === clipId);
    if (!clipToSplit) return;

    const currentTime = this.videoStateService.currentTime();

    let splitPoint = currentTime;
    if (splitPoint <= clipToSplit.startTime || splitPoint >= clipToSplit.endTime) {
      splitPoint = clipToSplit.startTime + (clipToSplit.duration / 2);
    }

    const minPossibleSplitPoint = clipToSplit.startTime + MIN_SUBTITLE_DURATION;
    const maxPossibleSplitPoint = clipToSplit.endTime - MIN_SUBTITLE_DURATION - MIN_GAP_DURATION;
    splitPoint = AssSubtitlesUtils.roundToAssPrecision(Math.max(minPossibleSplitPoint, Math.min(splitPoint, maxPossibleSplitPoint)));

    const originalSubtitlesForUndo = cloneDeep(clipToSplit.sourceSubtitles);
    const createdAndModifiedIds: string[] = [];
    const subtitlesToUpdate = new Map<string, SubtitleData>();
    const subtitlesToCreate: SubtitleData[] = [];
    const subtitlesToRemove = new Set<string>();
    const newSecondHalvesForAss: AssSubtitleData[] = [];

    for (const sub of clipToSplit.sourceSubtitles) {
      if (sub.startTime >= splitPoint) {
        const newId = uuidv4();
        createdAndModifiedIds.push(newId);
        const newSub = {
          ...cloneDeep(sub),
          id: newId,
          startTime: Math.max(sub.startTime, splitPoint + MIN_GAP_DURATION)
        };
        subtitlesToCreate.push(newSub);
        if (newSub.type === 'ass') {
          newSecondHalvesForAss.push(newSub);
        }
        subtitlesToRemove.add(sub.id);
      } else if (sub.startTime < splitPoint && sub.endTime > splitPoint) {
        createdAndModifiedIds.push(sub.id);
        const firstHalf = {...cloneDeep(sub), endTime: splitPoint};
        subtitlesToUpdate.set(firstHalf.id, firstHalf);

        const newId = uuidv4();
        createdAndModifiedIds.push(newId);
        const secondHalf = {...cloneDeep(sub), id: newId, startTime: splitPoint + MIN_GAP_DURATION};
        subtitlesToCreate.push(secondHalf);
        if (secondHalf.type === 'ass') {
          newSecondHalvesForAss.push(secondHalf);
        }
      }
    }

    onSplitCallback?.(originalSubtitlesForUndo, createdAndModifiedIds);

    let finalSubtitles = this._subtitles()
      .filter(s => !subtitlesToRemove.has(s.id))
      .map(sub => subtitlesToUpdate.get(sub.id) || sub)
      .concat(subtitlesToCreate);

    finalSubtitles.sort((a, b) => a.startTime - b.startTime);

    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) return;
    const updates: Partial<Project> = {subtitles: finalSubtitles};

    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.splitDialogueLines(
        project.rawAssContent,
        originalSubtitlesForUndo as AssSubtitleData[],
        splitPoint,
        newSecondHalvesForAss
      );
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(finalSubtitles);
    this.synchronizeStateAfterSplit(clipToSplit, splitPoint, currentTime);
  }

  public unsplitClip(originalSubtitles: SubtitleData[], createdAndModifiedIds: string[], originalRawAssContent?: string): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) return;

    const idsToRemove = new Set(createdAndModifiedIds);

    const restoredSubtitles = this._subtitles()
      .filter(s => !idsToRemove.has(s.id))
      .concat(originalSubtitles)
      .sort((a, b) => a.startTime - b.startTime);

    const updates: Partial<Project> = {subtitles: restoredSubtitles};

    if (originalRawAssContent !== undefined) {
      updates.rawAssContent = originalRawAssContent;
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(restoredSubtitles);

    // Re-sync active clip after undo:
    const currentTime = this.videoStateService.currentTime();
    const newClipsArray = this.clips();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      currentTime >= c.startTime && currentTime < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this.setCurrentClipByIndex(newCorrectIndex);
    }
  }

  public deleteCurrentClip(): void {
    const currentClip = this.currentClip();
    if (!currentClip) return;

    if (currentClip.hasSubtitle) {
      const command = new DeleteSubtitledClipCommand(this, currentClip);
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

  public deleteClip(clipToDelete: VideoClip): {
    originalSubtitles: SubtitleData[],
    originalRawAssContent?: string
  } | null {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) {
      return null;
    }

    const originalSubtitles = cloneDeep(this._subtitles());
    const originalRawAssContent = project.rawAssContent;
    const timeBeforeDelete = this.videoStateService.currentTime();

    let newSubtitles: SubtitleData[];
    const updates: Partial<Project> = {};

    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.deleteAssClipAndSplitSpanningLines(project.rawAssContent, clipToDelete);

      const clipStart = clipToDelete.startTime;
      const clipEnd = clipToDelete.endTime;
      newSubtitles = [];

      for (const sub of originalSubtitles) {
        if (sub.endTime <= clipStart || sub.startTime >= clipEnd) {
          // Keep: Subtitle is completely outside the deleted clip's range
          newSubtitles.push(sub);
        } else if (sub.startTime >= clipStart && sub.endTime <= clipEnd) {
          // Remove: Subtitle is completely inside the deleted clip
        } else if (sub.startTime < clipStart && sub.endTime > clipEnd) {
          // Split: Subtitle spans the entire deleted clip
          newSubtitles.push({...sub, endTime: clipStart});
          newSubtitles.push({...cloneDeep(sub), id: uuidv4(), startTime: clipEnd});
        } else if (sub.startTime < clipStart) {
          // Truncate: Subtitle overlaps the start of the deleted clip
          newSubtitles.push({...sub, endTime: clipStart});
        } else { // sub.endTime > clipEnd
          // Shift: Subtitle overlaps the end of the deleted clip
          newSubtitles.push({...sub, startTime: clipEnd});
        }
      }
      newSubtitles.sort((a, b) => a.startTime - b.startTime);
      updates.subtitles = newSubtitles;
    } else {
      const sourceIdsToDelete = new Set(clipToDelete.sourceSubtitles.map(s => s.id));
      newSubtitles = originalSubtitles.filter(sub => !sourceIdsToDelete.has(sub.id));
      updates.subtitles = newSubtitles;
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clips();
    let newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );
    if (newCorrectIndex === -1 && newClipsArray.length > 0) {
      newCorrectIndex = newClipsArray.findIndex(c => c.startTime >= timeBeforeDelete) - 1;
      if (newCorrectIndex < 0) newCorrectIndex = newClipsArray.length - 1;
    }

    if (newCorrectIndex !== -1) {
      this._currentClipIndex.set(newCorrectIndex);
    }

    return {originalSubtitles, originalRawAssContent};
  }

  public mergeClips(
    firstClipId: string,
    secondClipId: string,
    onMergeCallback?: (originalFirstSubtitles: SubtitleData[], deletedSecondSubtitles: SubtitleData[]) => void
  ): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) return;

    const firstClip = this.clips().find(c => c.id === firstClipId);
    const secondClip = this.clips().find(c => c.id === secondClipId);
    if (!firstClip || !secondClip) return;

    const originalFirstSubtitles = cloneDeep(firstClip.sourceSubtitles as SubtitleData[]);
    const originalSecondSubtitles = cloneDeep(secondClip.sourceSubtitles as SubtitleData[]);
    onMergeCallback?.(originalFirstSubtitles, originalSecondSubtitles);

    const gapStartTime = firstClip.endTime;
    const gapEndTime = secondClip.startTime;
    const midpoint = AssSubtitlesUtils.roundToAssPrecision(gapStartTime + ((gapEndTime - gapStartTime) / 2));

    const allSubsToModifyIds = new Set([...originalFirstSubtitles.map(s => s.id), ...originalSecondSubtitles.map(s => s.id)]);
    const newSubtitles = this._subtitles().map(sub => {
      if (!allSubsToModifyIds.has(sub.id)) {
        return sub;
      }
      const updatedSub = cloneDeep(sub);
      if (originalFirstSubtitles.some(s => s.id === updatedSub.id)) {
        updatedSub.endTime = midpoint;
      } else {
        updatedSub.startTime = midpoint;
      }
      return updatedSub;
    }).filter(s => {
      // Filter out any subtitles that would have zero or negative duration
      return s.endTime > s.startTime;
    });

    const updates: Partial<Project> = {subtitles: newSubtitles};

    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.mergeDialogueLines(project.rawAssContent, firstClip, secondClip);
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clips();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      midpoint >= c.startTime && midpoint < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._currentClipIndex.set(newCorrectIndex);
    }
  }

  public unmergeClips(
    originalFirstSubtitles: SubtitleData[],
    subtitlesToRestore: SubtitleData[]
  ): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) {
      return;
    }

    const allOriginalSubs = [...originalFirstSubtitles, ...subtitlesToRestore];
    const originalSubIds = new Set(allOriginalSubs.map(s => s.id));
    const currentSubtitles = this._subtitles();

    // Filter out the modified subtitles and then add back the originals
    const restoredSubtitles = currentSubtitles.filter(s => !originalSubIds.has(s.id));
    restoredSubtitles.push(...allOriginalSubs);
    restoredSubtitles.sort((a, b) => a.startTime - b.startTime);

    const updates: Partial<Project> = {subtitles: restoredSubtitles};

    if (project.rawAssContent) {
      const updatedSubs: AssSubtitleData[] = [];
      const originalSubs: AssSubtitleData[] = [];

      allOriginalSubs.forEach(originalSub => {
        const updatedSub = currentSubtitles.find(s => s.id === originalSub.id);
        if (updatedSub && updatedSub.type === 'ass' && originalSub.type === 'ass') {
          updatedSubs.push(updatedSub);
          originalSubs.push(originalSub);
        }
      });

      if (updatedSubs.length > 0) {
        updates.rawAssContent = this.assEditService.stretchClipTimings(
          updatedSubs,
          originalSubs,
          project.rawAssContent
        );
      }
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(restoredSubtitles);
  }

  public createNewSubtitledClipAtCurrentTime(): void {
    const currentClip = this.currentClip();
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project || !currentClip || currentClip.hasSubtitle) {
      this.toastService.info('A new subtitle can only be added inside a gap.');
      return;
    }

    // The gap must be large enough for the new subtitle and its surrounding gaps.
    const minimumRequiredSpace = MIN_SUBTITLE_DURATION + (2 * MIN_GAP_DURATION);
    if (currentClip.duration < minimumRequiredSpace) {
      this.toastService.warn(`This gap is too small to add a new subtitle. Minimum space required: ${minimumRequiredSpace.toFixed(2)}s`);
      return;
    }

    // Define boundaries for the new subtitle
    let newStartTime = this.videoStateService.currentTime();
    let newEndTime = newStartTime + MIN_SUBTITLE_DURATION;

    // Ensure the new subtitle respects the required gaps within the current gap.
    const earliestPossibleStart = currentClip.startTime + MIN_GAP_DURATION;
    const latestPossibleEnd = currentClip.endTime - MIN_GAP_DURATION;

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

    let newSubtitle: SubtitleData;
    if (project.rawAssContent) {
      newSubtitle = {
        type: 'ass',
        id: crypto.randomUUID(),
        startTime: newStartTime,
        endTime: newEndTime,
        parts: [{text: 'New Subtitle', style: 'Default', fragments: [{text: 'New Subtitle', isTag: false}]}]
      };
    } else {
      newSubtitle = {
        type: 'srt',
        id: crypto.randomUUID(),
        startTime: newStartTime,
        endTime: newEndTime,
        text: 'New Subtitle'
      };
    }

    const command = new CreateSubtitledClipCommand(this, newSubtitle);
    this.commandHistoryStateService.execute(command);

    // Seek to the start of the new clip for immediate feedback
    this.videoStateService.seekAbsolute(newStartTime);
  }

  public addSubtitle(subtitle: SubtitleData): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) {
      return;
    }

    const currentSubtitles = this._subtitles();
    const insertIndex = currentSubtitles.findIndex(s => s.startTime > subtitle.startTime);
    const newSubtitles = [...currentSubtitles];

    if (insertIndex === -1) {
      // If no subtitle starts after the new one, add it to the end
      newSubtitles.push(subtitle);
    } else {
      newSubtitles.splice(insertIndex, 0, subtitle);
    }

    const updates: Partial<Project> = {subtitles: newSubtitles};
    if (project.rawAssContent && subtitle.type === 'ass') {
      updates.rawAssContent = this.assEditService.createNewDialogueLine(project.rawAssContent, subtitle);
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);
  }

  public deleteSubtitles(subtitleIds: string[]): {
    deletedSubtitles: SubtitleData[],
    originalIndexes: number[]
  } | null {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) return null;

    const timeBeforeDelete = this.videoStateService.currentTime();

    // Find the clip context BEFORE filtering subtitles, which is needed for rawAssContent removal
    const clipToDelete = this.clips().find(c => c.sourceSubtitles.some(s => s.id === subtitleIds[0]));

    const deletedSubtitles: SubtitleData[] = [];
    const originalIndexes: number[] = [];
    const idsToDelete = new Set(subtitleIds);

    const newSubtitles = this._subtitles().filter((sub, index) => {
      if (idsToDelete.has(sub.id)) {
        deletedSubtitles.push(sub);
        originalIndexes.push(index);
        return false;
      }
      return true;
    });

    const updates: Partial<Project> = {subtitles: newSubtitles};
    if (project.rawAssContent && clipToDelete) {
      updates.rawAssContent = this.assEditService.removeDialogueLines(project.rawAssContent, clipToDelete);
    }

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clips();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._currentClipIndex.set(newCorrectIndex);
    }

    return {deletedSubtitles, originalIndexes};
  }

  public updateClipText(projectId: string, clip: VideoClip, newContent: ClipContent): void {
    const project = this.appStateService.getProjectById(projectId);

    if (project?.rawAssContent && newContent.parts) { // ASS
      const newRawAssContent = this.assEditService.updateClipText(
        clip,
        newContent,
        project.rawAssContent
      );

      const newSubtitles = [...this._subtitles()];

      // For each part that was edited in the UI...
      for (let i = 0; i < clip.parts.length; i++) {
        const oldPart = clip.parts[i];
        const newPart = newContent.parts[i];

        if (oldPart.text !== newPart.text) {
          // ...find EVERY subtitle object that is a source for the current clip...
          for (const sourceSub of clip.sourceSubtitles) {
            // Find the main subtitle by ID to ensure the correct one is updated
            const subtitleToUpdate = newSubtitles.find(s => s.id === sourceSub.id);
            if (subtitleToUpdate?.type === 'ass') {
              const partIndex = subtitleToUpdate.parts.findIndex(p => p.style === oldPart.style && p.text === oldPart.text);
              if (partIndex !== -1) {
                // ...and update it with the new part:
                const updatedParts = [...subtitleToUpdate.parts];
                updatedParts[partIndex] = newPart;
                (subtitleToUpdate as AssSubtitleData).parts = updatedParts;
              }
            }
          }
        }
      }

      this.appStateService.updateProject(projectId, {
        subtitles: newSubtitles,
        rawAssContent: newRawAssContent
      });

      this._subtitles.set(newSubtitles);
    } else if (newContent.text !== undefined) { // SRT
      const newSubtitles = [...this._subtitles()];
      const sourceSub = clip.sourceSubtitles[0];
      if (sourceSub) {
        const subIndex = newSubtitles.findIndex(s => s.id === sourceSub.id);
        if (subIndex !== -1) {
          (newSubtitles[subIndex] as SrtSubtitleData).text = newContent.text;
          this.appStateService.updateProject(projectId, {subtitles: newSubtitles});
          this._subtitles.set(newSubtitles);
        }
      }
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

  public applySubtitleUpdates(newSubtitles: SubtitleData[]): void {
    const project = this.appStateService.getProjectById(this._projectId!);
    if (!project) return;

    const originalSubtitles = this._subtitles();
    const updates: Partial<Project> = {subtitles: newSubtitles};

    if (project.rawAssContent) {
      const originalSubsToUpdate: AssSubtitleData[] = [];
      const updatedSubsToUpdate: AssSubtitleData[] = [];

      for (const newSub of newSubtitles) {
        const originalSub = originalSubtitles.find(s => s.id === newSub.id);
        if (originalSub && (originalSub.startTime !== newSub.startTime || originalSub.endTime !== newSub.endTime)) {
          if (originalSub.type === 'ass' && newSub.type === 'ass') {
            originalSubsToUpdate.push(originalSub);
            updatedSubsToUpdate.push(newSub);
          }
        }
      }

      if (originalSubsToUpdate.length > 0) {
        updates.rawAssContent = this.assEditService.stretchClipTimings(
          originalSubsToUpdate,
          updatedSubsToUpdate,
          project.rawAssContent
        );
        this.videoStateService.requestAssRendererSync();
      }
    }

    this.appStateService.updateProject(project.id, updates);
    this._subtitles.set(newSubtitles);
  }

  public updateClipTimesFromTimeline(clipId: string, newStartTime: number, newEndTime: number): void {
    const roundedStartTime = AssSubtitlesUtils.roundToAssPrecision(newStartTime);
    const roundedEndTime = AssSubtitlesUtils.roundToAssPrecision(newEndTime);
    const currentSubtitles = this.getSubtitles();
    const potentialNewSubtitles = this.calculateNewSubtitlesForUpdate(clipId, roundedStartTime, roundedEndTime);

    if (!potentialNewSubtitles || JSON.stringify(currentSubtitles) === JSON.stringify(potentialNewSubtitles)) {
      // No state change occurred, so don't add to the command history.
      return;
    }

    const command = new UpdateClipTimesCommand(this, potentialNewSubtitles);
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
    if (!currentClip) return;

    // Get a stable identifier for the clip BEFORE its properties (like ID/startTime) change.
    const sourceSubtitleIds = new Set(currentClip.sourceSubtitles.map(s => s.id));

    const adjustAmountSeconds = this.globalSettingsStateService.boundaryAdjustAmountMs() / 1000;
    const directionMultiplier = direction === 'left' ? -1 : 1;
    const changeAmount = adjustAmountSeconds * directionMultiplier;

    let newStartTime = currentClip.startTime;
    let newEndTime = currentClip.endTime;

    if (boundary === 'start') {
      newStartTime += changeAmount;
    } else {
      newEndTime += changeAmount;
    }

    const currentSubtitles = this.getSubtitles();
    const potentialNewSubtitles = this.calculateNewSubtitlesForUpdate(currentClip.id, newStartTime, newEndTime);

    if (!potentialNewSubtitles || JSON.stringify(currentSubtitles) === JSON.stringify(potentialNewSubtitles)) {
      return;
    }

    const command = new UpdateClipTimesCommand(this, potentialNewSubtitles);
    this.commandHistoryStateService.execute(command);

    // After state update, find the SAME logical clip using its stable source IDs.
    const updatedClip = this.clips().find(c => {
      if (c.sourceSubtitles.length !== sourceSubtitleIds.size) {
        return false;
      }
      return c.sourceSubtitles.every(s => sourceSubtitleIds.has(s.id));
    });

    if (!updatedClip) {
      return;
    }

    const currentTime = this.videoStateService.currentTime();
    let snappedTime: number | null = null;

    if (currentTime < updatedClip.startTime) {
      snappedTime = updatedClip.startTime;
    } else if (currentTime >= updatedClip.endTime) {
      // Snap to just before the end time to stay within the clip
      snappedTime = Math.max(updatedClip.startTime, updatedClip.endTime - 0.01);
    }

    if (snappedTime !== null) {
      this.videoStateService.seekAbsolute(snappedTime);
    }
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

          // For ASS, the key is the sorted list of unique parts (style + text)
          const assParts = new Map<string, SubtitlePart>();
          seg.sourceSubtitles.forEach(s => {
            if (s.type === 'ass') {
              s.parts.forEach(p => assParts.set(`${p.style}::${p.text}`, p));
            }
          });
          const sortedAssParts = Array.from(assParts.values()).sort((a, b) => a.style.localeCompare(b.style) || a.text.localeCompare(b.text));
          const assKey = JSON.stringify(sortedAssParts);

          // For SRT, the key is the combined text content
          const srtKey = seg.sourceSubtitles
            .filter(s => s.type === 'srt')
            .map(s => (s as SrtSubtitleData).text)
            .join('\\N'); // Use a separator that won't appear in normal text

          // The final key is a combination of both
          return `${assKey}|${srtKey}`;
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
    const targetClip = updatedClips[clipIndex];
    const oldStartTime = targetClip.startTime;
    const oldEndTime = targetClip.endTime;

    let finalStartTime = newStartTime;
    let finalEndTime = newEndTime;

    // First, enforce the minimum duration of the clip being dragged.
    const minDuration = targetClip.hasSubtitle ? MIN_SUBTITLE_DURATION : MIN_GAP_DURATION;
    if (finalEndTime - finalStartTime < minDuration) {
      // Determine which handle was stationary relative to the original clip state.
      // Use a small tolerance for floating point comparisons.
      const startHandleStationary = Math.abs(finalStartTime - oldStartTime) < 0.01;
      const endHandleStationary = Math.abs(finalEndTime - oldEndTime) < 0.01;

      if (startHandleStationary && !endHandleStationary) {
        // The start handle was the anchor, so adjust the end time.
        finalEndTime = finalStartTime + minDuration;
      } else if (!startHandleStationary && endHandleStationary) {
        // The end handle was the anchor, so adjust the start time.
        finalStartTime = finalEndTime - minDuration;
      } else {
        // This case covers an inversion (both handles moved relative to their names).
        // First check which handle stayed on its "side". If the start handle was dragged
        // across the end handle, the end handle is the anchor, and vice-versa.
        if (finalStartTime > oldEndTime) { // Left handle dragged past right handle
          finalStartTime = finalEndTime - minDuration;
        } else { // Right handle dragged past left handle
          finalEndTime = finalStartTime + minDuration;
        }
      }
    }

    // Second, handle collisions and interactions with other clips.
    // --- Adjusting START boundary (moving left handle) ---
    if (finalStartTime.toFixed(4) !== oldStartTime.toFixed(4)) {
      if (finalStartTime < oldStartTime) { // Expanding to the left
        let leftBoundary = 0;
        for (let i = clipIndex - 1; i >= 0; i--) {
          const clip = updatedClips[i];
          if (clip.hasSubtitle) {
            leftBoundary = clip.startTime + MIN_SUBTITLE_DURATION;
            break;
          }
        }
        if (finalStartTime < leftBoundary) finalStartTime = leftBoundary;
        for (let i = clipIndex - 1; i >= 0; i--) {
          const clip = updatedClips[i];
          if (clip.endTime > finalStartTime) {
            clip.endTime = finalStartTime;
            if (clip.startTime > clip.endTime) clip.startTime = clip.endTime;
          } else break;
        }
      } else { // Shrinking from the left (moving handle to the right)
        const prevClip = updatedClips[clipIndex - 1];
        if (prevClip && !targetClip.hasSubtitle) {
          prevClip.endTime = finalStartTime;
        }
      }
    }

    // --- Adjusting END boundary (moving right handle) ---
    if (finalEndTime.toFixed(4) !== oldEndTime.toFixed(4)) {
      if (finalEndTime > oldEndTime) { // Expanding to the right
        let rightBoundary = this.videoStateService.duration();
        for (let i = clipIndex + 1; i < updatedClips.length; i++) {
          const clip = updatedClips[i];
          if (clip.hasSubtitle) {
            rightBoundary = clip.endTime - MIN_SUBTITLE_DURATION;
            break;
          }
        }
        if (finalEndTime > rightBoundary) finalEndTime = rightBoundary;
        for (let i = clipIndex + 1; i < updatedClips.length; i++) {
          const clip = updatedClips[i];
          if (clip.startTime < finalEndTime) {
            clip.startTime = finalEndTime;
            if (clip.endTime < clip.startTime) clip.endTime = clip.startTime;
          } else break;
        }
      } else { // Shrinking from the right (moving handle to the left)
        const nextClip = updatedClips[clipIndex + 1];
        if (nextClip && !targetClip.hasSubtitle) {
          nextClip.startTime = finalEndTime;
        }
      }
    }

    targetClip.startTime = finalStartTime;
    targetClip.endTime = finalEndTime;

    updatedClips.forEach(c => c.duration = c.endTime - c.startTime);
    return updatedClips.filter(c => c.duration > 0.01);
  }

  private calculateNewSubtitlesForUpdate(clipId: string, newStartTime: number, newEndTime: number): SubtitleData[] | null {
    const originalClips = this.clips();
    const clipToUpdate = originalClips.find(c => c.id === clipId);

    if (!clipToUpdate) {
      console.error(`Cannot calculate update for clip ID ${clipId}: Clip not found.`);
      return null;
    }

    const updatedClips = this.calculateUpdatedClips(originalClips, clipId, newStartTime, newEndTime);
    const originalSubtitles = this._subtitles();
    const changedSubtitles = new Map<string, { original: SubtitleData, updated: SubtitleData }>();

    updatedClips.forEach(updatedClip => {
      if (!updatedClip.hasSubtitle) return;

      const originalClip = originalClips.find(oc => this.areVideoClipsEqual(oc, updatedClip));

      if (originalClip && (originalClip.startTime !== updatedClip.startTime || originalClip.endTime !== updatedClip.endTime)) {
        for (const sourceSub of updatedClip.sourceSubtitles) {
          const originalSourceSub = originalSubtitles.find(s => s.id === sourceSub.id);
          if (!originalSourceSub) continue;

          const updatedSub = cloneDeep(originalSourceSub);
          const oldDuration = originalClip.duration;
          const newDuration = updatedClip.duration;
          const wasStretched = Math.abs(oldDuration - newDuration) > 0.01;

          if (wasStretched && oldDuration > 0.01) {
            const startRatio = (originalSourceSub.startTime - originalClip.startTime) / oldDuration;
            const endRatio = (originalSourceSub.endTime - originalClip.startTime) / oldDuration;
            updatedSub.startTime = updatedClip.startTime + (startRatio * newDuration);
            updatedSub.endTime = updatedClip.startTime + (endRatio * newDuration);
          } else {
            const shiftAmount = updatedClip.startTime - originalClip.startTime;
            updatedSub.startTime = originalSourceSub.startTime + shiftAmount;
            updatedSub.endTime = originalSourceSub.endTime + shiftAmount;
          }
          changedSubtitles.set(updatedSub.id, {original: originalSourceSub, updated: updatedSub});
        }
      }
    });

    return originalSubtitles.map(sub => {
      const change = changedSubtitles.get(sub.id);
      return change ? change.updated : sub;
    }).map(s => ({
      ...s,
      startTime: AssSubtitlesUtils.roundToAssPrecision(s.startTime),
      endTime: AssSubtitlesUtils.roundToAssPrecision(s.endTime),
    }));
  }

  private areVideoClipsEqual(clipA?: VideoClip, clipB?: VideoClip): boolean {
    if (!clipA || !clipB || clipA.sourceSubtitles.length !== clipB.sourceSubtitles.length) {
      return false;
    }

    if (!clipA.hasSubtitle && !clipB.hasSubtitle) {
      return true;
    }

    const idsA = clipA.sourceSubtitles.map(s => s.id).sort().join(',');
    const idsB = clipB.sourceSubtitles.map(s => s.id).sort().join(',');

    return idsA === idsB;
  };

  private synchronizeStateAfterSplit(originalClip: VideoClip, splitPoint: number, currentTime: number): void {
    const newClipsArray = this.clips();
    let newActiveClip: VideoClip | undefined;

    if (currentTime < (originalClip.startTime + MIN_SUBTITLE_DURATION - 0.01)) {
      // Case 1: Split was clamped near the START of the original clip.
      // User intended to split early, so keep focus on the first part and don't move the playhead.
      newActiveClip = newClipsArray.find(c => c.endTime === splitPoint);
    } else if (currentTime > (originalClip.endTime - MIN_SUBTITLE_DURATION)) {
      // Case 2: Split was clamped near the END of the original clip.
      // User intended to split late, so switch focus to the second part and don't move the playhead.
      newActiveClip = newClipsArray.find(c => c.startTime === splitPoint + MIN_GAP_DURATION);
    } else {
      // Case 3: Normal split in the middle.
      // Focus on the first part and nudge the playhead to its end for a smooth workflow.
      newActiveClip = newClipsArray.find(c => c.endTime === splitPoint);
      if (newActiveClip) {
        this.videoStateService.seekAbsolute(splitPoint - 0.01);
      }
    }

    if (newActiveClip) {
      const newIndex = newClipsArray.indexOf(newActiveClip);
      if (newIndex !== -1) {
        this.setCurrentClipByIndex(newIndex);
      }
    }
  }
}
