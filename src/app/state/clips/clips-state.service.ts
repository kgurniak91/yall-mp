import {computed, effect, inject, Injectable, OnDestroy, Signal, signal, untracked} from '@angular/core';
import {VideoStateService} from '../video/video-state.service';
import {mapVideoClipToLightweight, PlayerState, SeekDirection, VideoClip} from '../../model/video.types';
import {CommandHistoryStateService} from '../command-history/command-history-state.service';
import {UpdateClipTimesCommand} from '../../model/commands/update-clip-times.command';
import {ToastService} from '../../shared/services/toast/toast.service';
import {SplitSubtitledClipCommand} from '../../model/commands/split-subtitled-clip.command';
import {RemoveGapCommand} from '../../model/commands/remove-gap.command';
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
import {Project, ProjectClipNotes} from '../../model/project.types';
import {cloneDeep, isEqual} from 'lodash-es';
import {v4 as uuidv4} from 'uuid';
import {AssSubtitlesUtils} from '../../../../shared/utils/ass-subtitles.utils';
import {ConfirmationService} from 'primeng/api';
import {MergeSubtitlesCommand} from '../../model/commands/merge-subtitles.command';
import {ShiftAllSubtitlesCommand} from '../../model/commands/shift-all-subtitles.command';
import {DEFAULT_CONFIRMATION} from '../../shared/types/confirmation.types';

export interface ShiftValidationResult {
  totalClips: number;
  deletedClips: number;
  truncatedClips: number;
}

export const ADJUST_DEBOUNCE_MS = 50;
export const MIN_GAP_DURATION = 0;
export const MIN_SUBTITLE_DURATION = 0.1;
export const MIN_REQUIRED_SPACE_FOR_NEW_CLIP = MIN_SUBTITLE_DURATION + (2 * MIN_GAP_DURATION);
export const MIN_REQUIRED_CLIP_DURATION_FOR_SPLIT = (MIN_SUBTITLE_DURATION * 2) + MIN_GAP_DURATION;

@Injectable()
export class ClipsStateService implements OnDestroy {
  private readonly videoStateService = inject(VideoStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly commandHistoryStateService = inject(CommandHistoryStateService);
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);
  private readonly assEditService = inject(AssEditService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly _subtitles = signal<SubtitleData[]>([]);
  private readonly _activeTrack = signal(0);
  private readonly _masterClipIndex = signal(0); // Track master clip index, works across flattened and merged collection of video clips
  private readonly _playerState = signal<PlayerState>(PlayerState.Idle);
  private adjustDebounceTimer: any;
  private _projectId: string | null = null;
  private readonly cleanupPlaybackListener: (() => void) | null = null;
  private lastMinDurationToastTime = 0;

  public readonly activeTrack = this._activeTrack.asReadonly();
  public readonly masterClipIndex = this._masterClipIndex.asReadonly();
  public readonly activeTrackClipIndex = computed(() => {
    const masterClipIndex = this._masterClipIndex();
    const allClips = this.clipsForAllTracks();
    const trackClips = this.clips();

    if (masterClipIndex < 0 || masterClipIndex >= allClips.length || trackClips.length === 0) {
      return -1;
    }

    const masterClip = allClips[masterClipIndex];
    if (!masterClip) {
      return -1;
    }

    // Find clip on current track that contains the start time of the master clip
    const targetTime = masterClip.startTime + 0.0001;

    let low = 0;
    let high = trackClips.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1; // Bitwise shift is slightly faster than Math.floor
      const clip = trackClips[mid];

      if (targetTime >= clip.startTime && targetTime < clip.endTime) {
        return mid;
      }

      if (targetTime < clip.startTime) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return -1;
  });
  public readonly playerState = this._playerState.asReadonly();
  public readonly isPlaying = computed(() => this.playerState() === PlayerState.Playing);
  public readonly clipsForAllTracks: Signal<VideoClip[]> = computed(() => this.generateClips(this._subtitles()));
  public readonly clips: Signal<VideoClip[]> = computed(() => {
    const activeTrackIndex = this._activeTrack();
    const subtitlesForActiveTrack = this._subtitles().filter(s => s.track === activeTrackIndex);
    return this.generateClips(subtitlesForActiveTrack);
  });

  public readonly currentClip = computed<VideoClip | undefined>(() => {
    return this.clips()[this.activeTrackClipIndex()];
  });

  public readonly currentClipForAllTracks = computed<VideoClip | undefined>(() => {
    return this.clipsForAllTracks()[this.masterClipIndex()];
  });

  public readonly totalTracks = computed(() => {
    const subtitles = this._subtitles();
    if (subtitles.length === 0) {
      return 1;
    }

    // Track numbers are 0-indexed, so max track number + 1 is the total count
    return Math.max(...subtitles.map(s => s.track)) + 1;
  });

  public readonly subtitlesAtCurrentTime = computed(() => {
    const time = this.videoStateService.currentTime();
    return this._subtitles().filter(sub => time >= sub.startTime && time < sub.endTime);
  });

  constructor() {
    effect(() => {
      const currentClips = this.clipsForAllTracks();
      if (currentClips.length > 0) {
        const lightweightClips = currentClips.map((clip: VideoClip) => mapVideoClipToLightweight(clip));
        const currentTime = untracked(() => this.videoStateService.currentTime());
        window.electronAPI.playbackUpdateClips(lightweightClips, currentTime);
      }
    });

    this.cleanupPlaybackListener = window.electronAPI.onPlaybackStateUpdate((update) => {
      this.setPlayerState(update.playerState);
      this._masterClipIndex.set(update.currentClipIndex);
    });
  }

  ngOnDestroy(): void {
    if (this.cleanupPlaybackListener) {
      this.cleanupPlaybackListener();
    }
  }

  public setActiveTrack(trackIndex: number): void {
    if (trackIndex >= 0 && trackIndex < this.totalTracks() && this._activeTrack() !== trackIndex) {
      this._activeTrack.set(trackIndex);
      this.toastService.info(`Switched to track ${trackIndex + 1}`);
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
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const updates: Partial<Project> = {subtitles: originalSubtitles};

    if (originalRawAssContent) {
      updates.rawAssContent = originalRawAssContent;
    }

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(originalSubtitles);

    // Re-sync active clip after undo
    const currentTime = this.videoStateService.currentTime();
    const newClipsArray = this.clipsForAllTracks();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      currentTime >= c.startTime && currentTime < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this.setCurrentClipByIndex(newCorrectIndex);
    }
  }

  public setCurrentClipByIndex(index: number): void {
    const allClips = this.clipsForAllTracks();
    if (index >= 0 && index < allClips.length) {
      this._masterClipIndex.set(index);
    }
  }

  public splitClip(clipId?: string, splitTime?: number): void {
    const targetClip = clipId
      ? this.clips().find(c => c.id === clipId)
      : this.currentClip();

    if (!targetClip || !targetClip.hasSubtitle) {
      return;
    }

    if (targetClip.duration < MIN_REQUIRED_CLIP_DURATION_FOR_SPLIT) {
      this.toastService.warn(`Selected clip is too short to split. Minimum required duration is ${MIN_REQUIRED_CLIP_DURATION_FOR_SPLIT.toFixed(1)}s.`);
      return;
    }

    const project = this.appStateService.currentProject();
    const command = new SplitSubtitledClipCommand(this, targetClip.id, project?.rawAssContent, splitTime);
    this.commandHistoryStateService.execute(command);
  }

  public splitSubtitledClip(
    clipId: string,
    requestedSplitTime?: number,
    onSplitCallback?: (
      originalSubtitles: SubtitleData[],
      createdAndModifiedIds: string[],
      originalNotes: Record<string, ProjectClipNotes>
    ) => void
  ): void {
    const clipToSplit = this.clips().find(c => c.id === clipId);
    const project = this.appStateService.currentProject();

    if (!clipToSplit || !project) {
      return;
    }

    const currentTime = this.videoStateService.currentTime();
    const currentProjectNotes = project.notes || {};
    const sourceIds = clipToSplit.sourceSubtitles.map(s => s.id);

    // Capture notes snapshot for undo operation
    const originalNotesForUndo: Record<string, ProjectClipNotes> = {};
    sourceIds.forEach(id => {
      if (currentProjectNotes[id]) {
        originalNotesForUndo[id] = cloneDeep(currentProjectNotes[id]);
      }
    });

    // Generate aggregated notes for the new right-hand clip
    const aggregatedNotes = this.getAggregatedClipNotes(sourceIds, currentProjectNotes);

    let splitPoint = requestedSplitTime ?? currentTime;
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
    const leftGroupId = uuidv4();
    const rightGroupId = uuidv4();

    for (const sub of clipToSplit.sourceSubtitles) {
      if (sub.startTime >= splitPoint) {
        const newId = uuidv4();
        createdAndModifiedIds.push(newId);

        const newSub = this.trimSubtitleToBoundaries(sub, splitPoint + MIN_GAP_DURATION, sub.endTime);
        if (newSub) {
          newSub.id = newId;
          newSub.splitGroupId = rightGroupId;
          subtitlesToCreate.push(newSub);
          if (newSub.type === 'ass') {
            newSecondHalvesForAss.push(newSub as AssSubtitleData);
          }
        }
        subtitlesToRemove.add(sub.id);
      } else if (sub.startTime < splitPoint && sub.endTime > splitPoint) {
        createdAndModifiedIds.push(sub.id);

        const firstHalf = this.trimSubtitleToBoundaries(sub, sub.startTime, splitPoint);
        if (firstHalf) {
          firstHalf.splitGroupId = leftGroupId;
          subtitlesToUpdate.set(firstHalf.id, firstHalf);
        }

        const newId = uuidv4();
        createdAndModifiedIds.push(newId);
        const secondHalf = this.trimSubtitleToBoundaries(sub, splitPoint + MIN_GAP_DURATION, sub.endTime);
        if (secondHalf) {
          secondHalf.id = newId;
          secondHalf.splitGroupId = rightGroupId;
          subtitlesToCreate.push(secondHalf);
          if (secondHalf.type === 'ass') {
            newSecondHalvesForAss.push(secondHalf as AssSubtitleData);
          }
        }
      }
    }

    onSplitCallback?.(originalSubtitlesForUndo, createdAndModifiedIds, originalNotesForUndo);

    let finalSubtitles = this._subtitles()
      .filter(s => !subtitlesToRemove.has(s.id))
      .map(sub => subtitlesToUpdate.get(sub.id) || sub)
      .concat(subtitlesToCreate);

    finalSubtitles.sort((a, b) => a.startTime - b.startTime);

    const updates: Partial<Project> = {subtitles: finalSubtitles};

    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.splitDialogueLines(
        project.rawAssContent,
        originalSubtitlesForUndo as AssSubtitleData[],
        splitPoint,
        newSecondHalvesForAss
      );
    }

    // Add notes to the new (right) clip
    const hasNotesToCopy = Object.keys(aggregatedNotes.lookupNotes || {}).length > 0 || aggregatedNotes.manualNote || aggregatedNotes.hint;

    if (hasNotesToCopy && subtitlesToCreate.length > 0) {
      const rightClipRepresentativeId = subtitlesToCreate[0].id;
      const newProjectNotes = cloneDeep(currentProjectNotes);

      newProjectNotes[rightClipRepresentativeId] = cloneDeep(aggregatedNotes);
      updates.notes = newProjectNotes;
    }

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(finalSubtitles);
    this.synchronizeStateAfterSplit(clipToSplit, splitPoint, currentTime);
  }

  public unsplitClip(
    originalSubtitles: SubtitleData[],
    createdAndModifiedIds: string[],
    originalRawAssContent?: string,
    originalNotes?: Record<string, ProjectClipNotes>
  ): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const performUnsplit = () => {
      const idsToRemove = new Set(createdAndModifiedIds);

      const restoredSubtitles = this._subtitles()
        .filter(s => !idsToRemove.has(s.id))
        .concat(originalSubtitles)
        .sort((a, b) => a.startTime - b.startTime);

      const updates: Partial<Project> = {subtitles: restoredSubtitles};

      if (originalRawAssContent !== undefined) {
        updates.rawAssContent = originalRawAssContent;
      }

      // Restore notes
      const newProjectNotes = cloneDeep(project.notes || {});
      createdAndModifiedIds.forEach(id => delete newProjectNotes[id]);

      if (originalNotes) {
        Object.entries(originalNotes).forEach(([id, note]) => {
          newProjectNotes[id] = note;
        });
      }
      updates.notes = newProjectNotes;

      this.appStateService.updatePartialProject(this._projectId!, updates);
      this._subtitles.set(restoredSubtitles);

      // Re-sync active clip after undo:
      const currentTime = this.videoStateService.currentTime();
      const newClipsArray = this.clipsForAllTracks();
      const newCorrectIndex = newClipsArray.findIndex(c =>
        currentTime >= c.startTime && currentTime < c.endTime
      );

      if (newCorrectIndex !== -1) {
        this.setCurrentClipByIndex(newCorrectIndex);
      }
    };

    // Check for note discrepancies
    if (project.notes && createdAndModifiedIds.length >= 2) {
      const leftIds = createdAndModifiedIds.filter(id => originalSubtitles.some(orig => orig.id === id));
      const rightIds = createdAndModifiedIds.filter(id => !leftIds.includes(id));

      const leftAggregated = this.getAggregatedClipNotes(leftIds, project.notes);
      const rightAggregated = this.getAggregatedClipNotes(rightIds, project.notes);

      if (!isEqual(leftAggregated, rightAggregated)) {
        this.confirmationService.confirm({
          ...DEFAULT_CONFIRMATION,
          header: 'Notes Mismatch',
          message: 'The notes in the clips you are merging differ. Any changes made to the notes after splitting will be lost. Continue?',
          accept: () => performUnsplit(),
          reject: () => this.commandHistoryStateService.cancelLastUndo()
        });
        return;
      }
    }

    performUnsplit();
  }

  public deleteCurrentClip(): void {
    const currentClip = this.currentClip();
    if (!currentClip) return;

    if (currentClip.hasSubtitle) {
      const command = new DeleteSubtitledClipCommand(this, currentClip);
      this.commandHistoryStateService.execute(command);
    } else {
      const clips = this.clips();
      const currentIndex = this.activeTrackClipIndex();
      const prevClip = clips[currentIndex - 1];
      const nextClip = clips[currentIndex + 1];

      if (!prevClip || !nextClip || !prevClip.hasSubtitle || !nextClip.hasSubtitle) {
        this.toastService.warn('Cannot delete a gap at the beginning or end of the timeline');
        return;
      }

      const command = new RemoveGapCommand(this, prevClip.id, nextClip.id);
      this.commandHistoryStateService.execute(command);
    }
  }

  public deleteClip(clipToDelete: VideoClip): {
    originalSubtitles: SubtitleData[],
    originalRawAssContent?: string
  } | null {
    const project = this.appStateService.currentProject();
    if (!project) {
      return null;
    }

    const originalSubtitles = cloneDeep(this._subtitles());
    const originalRawAssContent = project.rawAssContent;
    const timeBeforeDelete = this.videoStateService.currentTime();

    let newSubtitles: SubtitleData[];
    const updates: Partial<Project> = {};
    const sourceIdsToDelete = new Set(clipToDelete.sourceSubtitles.map(s => s.id));

    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.removeDialogueLines(project.rawAssContent, clipToDelete);
      newSubtitles = originalSubtitles.filter(sub => !sourceIdsToDelete.has(sub.id));
      updates.subtitles = newSubtitles;
    } else { // SRT
      newSubtitles = originalSubtitles.filter(sub => !sourceIdsToDelete.has(sub.id));
      updates.subtitles = newSubtitles;
    }

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clipsForAllTracks();
    let newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );
    if (newCorrectIndex === -1 && newClipsArray.length > 0) {
      newCorrectIndex = newClipsArray.findIndex(c => c.startTime >= timeBeforeDelete) - 1;
      if (newCorrectIndex < 0) newCorrectIndex = newClipsArray.length - 1;
    }

    if (newCorrectIndex !== -1) {
      this._masterClipIndex.set(newCorrectIndex);
    }

    return {originalSubtitles, originalRawAssContent};
  }

  public removeGap(
    firstClipId: string,
    secondClipId: string,
    onMergeCallback?: (originalFirstSubtitles: SubtitleData[], deletedSecondSubtitles: SubtitleData[]) => void
  ): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const firstClip = this.clips().find(c => c.id === firstClipId);
    const secondClip = this.clips().find(c => c.id === secondClipId);
    if (!firstClip || !secondClip) {
      return;
    }

    const originalFirstSubtitles = cloneDeep(firstClip.sourceSubtitles as SubtitleData[]);
    const originalSecondSubtitles = cloneDeep(secondClip.sourceSubtitles as SubtitleData[]);
    onMergeCallback?.(originalFirstSubtitles, originalSecondSubtitles);

    const gapStartTime = firstClip.endTime;
    const gapEndTime = secondClip.startTime;
    const midpoint = AssSubtitlesUtils.roundToAssPrecision(gapStartTime + ((gapEndTime - gapStartTime) / 2));
    const newMergedGroupId = uuidv4();
    const allSubsToModifyIds = new Set([...originalFirstSubtitles.map(s => s.id), ...originalSecondSubtitles.map(s => s.id)]);

    const newSubtitles = this._subtitles().map(sub => {
      if (!allSubsToModifyIds.has(sub.id)) {
        return sub;
      }
      const updatedSub = cloneDeep(sub);
      updatedSub.splitGroupId = newMergedGroupId;
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

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clipsForAllTracks();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      midpoint >= c.startTime && midpoint < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._masterClipIndex.set(newCorrectIndex);
    }
  }

  public restoreGap(
    originalFirstSubtitles: SubtitleData[],
    subtitlesToRestore: SubtitleData[]
  ): void {
    const project = this.appStateService.currentProject();
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

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(restoredSubtitles);
  }

  public mergeCurrentGapSubtitles(): void {
    const currentClip = this.currentClip();
    if (!currentClip || currentClip.hasSubtitle) {
      this.toastService.info('Please select a gap between two subtitles');
      return;
    }

    const project = this.appStateService.currentProject();
    if (project?.rawAssContent) {
      this.toastService.warn('Merging subtitles is not supported for ASS/SSA projects');
      return;
    }

    const clips = this.clips();
    const currentIndex = this.activeTrackClipIndex();
    const prevClip = clips[currentIndex - 1];
    const nextClip = clips[currentIndex + 1];

    if (!prevClip || !nextClip || !prevClip.hasSubtitle || !nextClip.hasSubtitle) {
      this.toastService.warn('Can only merge a gap that is surrounded by subtitles');
      return;
    }

    const command = new MergeSubtitlesCommand(this, currentClip.id);
    this.commandHistoryStateService.execute(command);
  }

  public mergeSubtitles(
    gapClipId: string,
    onMergeCallback?: (
      originalSubtitles: SubtitleData[],
      newMergedSubtitleId: string,
      originalNotes: Record<string, ProjectClipNotes>
    ) => void
  ): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    if (project.rawAssContent) {
      console.error("Cannot merge subtitles in an ASS/SSA project.");
      return;
    }

    const clips = this.clips();
    const gapIndex = clips.findIndex(c => c.id === gapClipId);
    if (gapIndex === -1) {
      return;
    }

    const prevClip = clips[gapIndex - 1];
    const nextClip = clips[gapIndex + 1];

    if (!prevClip || !nextClip || !prevClip.hasSubtitle || !nextClip.hasSubtitle) {
      return;
    }

    const originalSubtitles: SubtitleData[] = [
      ...prevClip.sourceSubtitles,
      ...nextClip.sourceSubtitles
    ].map(s => cloneDeep(s));

    const sourceIds = originalSubtitles.map(s => s.id);
    const currentProjectNotes = project.notes || {};
    const originalNotesForUndo: Record<string, ProjectClipNotes> = {};

    // Capture snapshot of original notes
    sourceIds.forEach(id => {
      if (currentProjectNotes[id]) {
        originalNotesForUndo[id] = cloneDeep(currentProjectNotes[id]);
      }
    });

    const aggregatedNotes = this.getAggregatedClipNotes(sourceIds, currentProjectNotes);

    const newSubtitleId = uuidv4();
    onMergeCallback?.(originalSubtitles, newSubtitleId, originalNotesForUndo);

    // Join text
    const leftText = prevClip.text || '';
    const rightText = nextClip.text || '';
    const mergedText = `${leftText}\n${rightText}`;

    // Create new unified subtitle
    const newStartTime = prevClip.startTime;
    const newEndTime = nextClip.endTime;

    const newSubtitle: SrtSubtitleData = {
      type: 'srt',
      id: newSubtitleId,
      startTime: newStartTime,
      endTime: newEndTime,
      text: mergedText,
      track: this._activeTrack()
    };

    const idsToRemove = new Set(sourceIds);

    // Create new state
    const newSubtitlesState = this._subtitles().filter(s => !idsToRemove.has(s.id));
    newSubtitlesState.push(newSubtitle);
    newSubtitlesState.sort((a, b) => a.startTime - b.startTime);

    // Swap notes to the new ID
    const newProjectNotes = cloneDeep(currentProjectNotes);
    sourceIds.forEach(id => delete newProjectNotes[id]);

    const hasNotesToCopy = Object.keys(aggregatedNotes.lookupNotes || {}).length > 0 || aggregatedNotes.manualNote || aggregatedNotes.hint;
    if (hasNotesToCopy) {
      newProjectNotes[newSubtitleId] = cloneDeep(aggregatedNotes);
    }

    this.appStateService.updatePartialProject(this._projectId!, {
      subtitles: newSubtitlesState,
      notes: newProjectNotes
    });
    this._subtitles.set(newSubtitlesState);

    // Resync: The playhead is inside what used to be the gap. It is now inside the new merged clip.
    const currentTime = this.videoStateService.currentTime();
    const newClipsArray = this.clipsForAllTracks();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      currentTime >= c.startTime && currentTime < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._masterClipIndex.set(newCorrectIndex);
    }
  }

  public unmergeSubtitles(
    originalSubtitles: SubtitleData[],
    mergedSubtitleId: string,
    originalNotes: Record<string, ProjectClipNotes>
  ): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const performUnmerge = () => {
      const currentSubtitles = this._subtitles();
      let newSubtitlesState = currentSubtitles.filter(s => s.id !== mergedSubtitleId);

      // Add back originals
      newSubtitlesState.push(...originalSubtitles);
      newSubtitlesState.sort((a, b) => a.startTime - b.startTime);

      // Restore notes
      const newProjectNotes = cloneDeep(project.notes || {});
      delete newProjectNotes[mergedSubtitleId];
      if (originalNotes) {
        Object.entries(originalNotes).forEach(([id, note]) => {
          newProjectNotes[id] = note;
        });
      }

      this.appStateService.updatePartialProject(this._projectId!, {
        subtitles: newSubtitlesState,
        notes: newProjectNotes
      });
      this._subtitles.set(newSubtitlesState);

      // Resync active clip
      const currentTime = this.videoStateService.currentTime();
      const newClipsArray = this.clipsForAllTracks();
      const newCorrectIndex = newClipsArray.findIndex(c =>
        currentTime >= c.startTime && currentTime < c.endTime
      );

      if (newCorrectIndex !== -1) {
        this._masterClipIndex.set(newCorrectIndex);
      }
    };

    // Check for note discrepancies
    const currentMergedNotes = project.notes?.[mergedSubtitleId];
    const aggregatedOriginalNotes = this.getAggregatedClipNotes(originalSubtitles.map(s => s.id), originalNotes);

    const normalize = (n: ProjectClipNotes | undefined) => ({
      lookupNotes: n?.lookupNotes && Object.keys(n.lookupNotes).length > 0 ? n.lookupNotes : undefined,
      manualNote: n?.manualNote?.trim() || undefined,
      hint: n?.hint?.trim() || undefined
    });

    if (!isEqual(normalize(currentMergedNotes), normalize(aggregatedOriginalNotes))) {
      this.confirmationService.confirm({
        ...DEFAULT_CONFIRMATION,
        header: 'Notes Mismatch',
        message: 'The notes in the merged clip have been modified. Unmerging will restore the original notes for each clip (from before the merge) and discard recent changes. Continue?',
        accept: () => performUnmerge(),
        reject: () => this.commandHistoryStateService.cancelLastUndo()
      });
      return;
    }

    performUnmerge();
  }

  public createNewSubtitledClipAtCurrentTime(): void {
    const currentClip = this.currentClip();
    const project = this.appStateService.currentProject();
    if (!project || !currentClip || currentClip.hasSubtitle) {
      this.toastService.info('A new subtitle can only be added inside a gap');
      return;
    }

    if (currentClip.duration < MIN_REQUIRED_SPACE_FOR_NEW_CLIP) {
      this.toastService.warn(`This gap is too small to add a new subtitle. Minimum space required: ${MIN_REQUIRED_SPACE_FOR_NEW_CLIP.toFixed(1)}s`);
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
      this.toastService.warn('Not enough space to add a new subtitle at this exact time');
      return;
    }

    let newSubtitle: SubtitleData;
    if (project.rawAssContent) {
      newSubtitle = {
        type: 'ass',
        id: crypto.randomUUID(),
        startTime: newStartTime,
        endTime: newEndTime,
        parts: [{text: 'New Subtitle', style: 'Default', fragments: [{text: 'New Subtitle', isTag: false}]}],
        track: this._activeTrack()
      };
    } else {
      newSubtitle = {
        type: 'srt',
        id: crypto.randomUUID(),
        startTime: newStartTime,
        endTime: newEndTime,
        text: 'New Subtitle',
        track: this._activeTrack()
      };
    }

    const command = new CreateSubtitledClipCommand(this, newSubtitle);
    this.commandHistoryStateService.execute(command);

    // Seek to the start of the new clip for immediate feedback
    this.videoStateService.seekAbsolute(newStartTime);
  }

  public addSubtitle(subtitle: SubtitleData): void {
    const project = this.appStateService.currentProject();
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

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);
  }

  public deleteSubtitles(subtitleIds: string[]): {
    deletedSubtitles: SubtitleData[],
    originalIndexes: number[]
  } | null {
    const project = this.appStateService.currentProject();
    if (!project) return null;

    const timeBeforeDelete = this.videoStateService.currentTime();

    // Find the clip context BEFORE filtering subtitles, which is needed for rawAssContent removal
    const clipToDelete = this.clipsForAllTracks().find(c => c.sourceSubtitles.some(s => s.id === subtitleIds[0]));

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

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);

    const newClipsArray = this.clipsForAllTracks();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      timeBeforeDelete >= c.startTime && timeBeforeDelete < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._masterClipIndex.set(newCorrectIndex);
    }

    return {deletedSubtitles, originalIndexes};
  }

  public updateClipText(projectId: string, clipId: string, newContent: ClipContent): void {
    const project = this.appStateService.currentProject();
    const clip = this.clipsForAllTracks().find(c => c.id === clipId);

    if (!project || !clip) {
      console.error('Could not update clip text: project or clip not found.');
      return;
    }

    if (project.rawAssContent && newContent.parts) { // ASS
      const newRawAssContent = this.assEditService.modifyAssText(
        clip,
        newContent,
        project.rawAssContent
      );

      const newSubtitles = cloneDeep(this._subtitles());

      const updateNestedSubtitles = (subtitle: AssSubtitleData, oldPart: SubtitlePart, newPart: SubtitlePart) => {
        // Recursive function to traverse sourceDialogues
        if (subtitle.sourceDialogues && subtitle.sourceDialogues.length > 0) {
          subtitle.sourceDialogues.forEach(sub => updateNestedSubtitles(sub, oldPart, newPart));
        }

        // Update the parts on the current level (leaf node or parent)
        subtitle.parts = subtitle.parts.map(currentPartInState => {
          if (currentPartInState.style === oldPart.style && currentPartInState.text === oldPart.text) {
            const updatedPart = {...currentPartInState, text: newPart.text};
            if (updatedPart.fragments && newPart.fragments) {
              const newTextFragmentsOnly = newPart.fragments.filter(f => !f.isTag);
              let textFragmentIndex = 0;
              updatedPart.fragments = updatedPart.fragments.map(frag => {
                if (frag.isTag) {
                  return frag;
                }
                const newText = newTextFragmentsOnly[textFragmentIndex]?.text ?? '';
                textFragmentIndex++;
                return {...frag, text: newText};
              });
            }
            return updatedPart;
          }
          return currentPartInState;
        });
      };

      for (let i = 0; i < clip.parts.length; i++) {
        const oldPart = clip.parts[i];
        const newPart = newContent.parts[i];
        if (!newPart || isEqual(oldPart, newPart)) continue;

        for (const sourceSub of clip.sourceSubtitles) {
          const subtitleToUpdate = newSubtitles.find(s => s.id === sourceSub.id);
          if (subtitleToUpdate?.type === 'ass') {
            updateNestedSubtitles(subtitleToUpdate, oldPart, newPart);
          }
        }
      }

      this.appStateService.updatePartialProject(projectId, {
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
          this.appStateService.updatePartialProject(projectId, {subtitles: newSubtitles});
          this._subtitles.set(newSubtitles);
        }
      }
    }
  }

  public goToAdjacentSubtitledClip(direction: SeekDirection): void {
    const adjacentClip = this.findAdjacentSubtitledClip(direction);
    if (adjacentClip) {
      this.videoStateService.seekAbsolute(adjacentClip.startTime, true);
    } else if (direction === SeekDirection.Previous) {
      const current = this.currentClip();
      if (current?.hasSubtitle) {
        this.videoStateService.seekAbsolute(current.startTime, true);
      }
    }
  }

  public applySubtitleUpdates(newSubtitles: SubtitleData[]): void {
    const project = this.appStateService.currentProject();
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

    this.appStateService.updatePartialProject(project.id, updates);
    this._subtitles.set(newSubtitles);
  }

  public updateClipTimesFromTimeline(clipId: string, newStartTime: number, newEndTime: number): void {
    const roundedStartTime = AssSubtitlesUtils.roundToAssPrecision(newStartTime);
    const roundedEndTime = AssSubtitlesUtils.roundToAssPrecision(newEndTime);
    const clipToUpdate = this.clips().find(c => c.id === clipId);

    this.showMinDurationToastIfNecessary(clipToUpdate, roundedStartTime, roundedEndTime);

    const currentSubtitles = this.getSubtitles();
    const potentialNewSubtitles = this.calculateNewSubtitlesForUpdate(clipId, roundedStartTime, roundedEndTime);

    if (!potentialNewSubtitles || JSON.stringify(currentSubtitles) === JSON.stringify(potentialNewSubtitles)) {
      // No state change occurred, so don't add to the command history.
      return;
    }

    const project = this.appStateService.currentProject();
    const command = new UpdateClipTimesCommand(this, potentialNewSubtitles, project?.rawAssContent);
    this.commandHistoryStateService.execute(command);
  }

  public adjustCurrentClipBoundary(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    clearTimeout(this.adjustDebounceTimer);

    this.adjustDebounceTimer = setTimeout(() => {
      this.performAdjust(boundary, direction);
    }, ADJUST_DEBOUNCE_MS);
  }

  public validateGlobalTransform(offset: number, ratio: number): ShiftValidationResult {
    const subtitles = this._subtitles();
    const duration = this.videoStateService.duration();

    let deleted = 0;
    let truncated = 0;

    for (const sub of subtitles) {
      const newStart = (sub.startTime * ratio) + offset;
      const newEnd = (sub.endTime * ratio) + offset;

      if (newEnd <= 0 || newStart >= duration) {
        deleted++;
        continue;
      }

      if ((newStart < 0 && newEnd > 0) || (newStart < duration && newEnd > duration)) {
        truncated++;
      }
    }

    return {
      totalClips: subtitles.length,
      deletedClips: deleted,
      truncatedClips: truncated
    };
  }

  public transformAllSubtitles(offset: number, ratio: number): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const command = new ShiftAllSubtitlesCommand(this, offset, ratio, project.rawAssContent);
    this.commandHistoryStateService.execute(command);
  }

  public performGlobalTransform(offset: number, ratio: number): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    const currentSubtitles = this._subtitles();
    const duration = this.videoStateService.duration();
    const newSubtitles: SubtitleData[] = [];

    const transformAssSubsRecursively = (sub: AssSubtitleData): AssSubtitleData | null => {
      const sStart = (sub.startTime * ratio) + offset;
      const sEnd = (sub.endTime * ratio) + offset;
      if (sEnd <= 0 || sStart >= duration) {
        return null;
      }

      const finalStart = AssSubtitlesUtils.roundToAssPrecision(Math.max(0, sStart));
      const finalEnd = AssSubtitlesUtils.roundToAssPrecision(Math.min(duration, sEnd));

      const newSub = cloneDeep(sub);
      newSub.startTime = finalStart;
      newSub.endTime = finalEnd;

      if (newSub.sourceDialogues) {
        newSub.sourceDialogues = newSub.sourceDialogues
          .map(child => transformAssSubsRecursively(child))
          .filter((child): child is AssSubtitleData => child !== null);
      }

      return newSub;
    };

    for (const sub of currentSubtitles) {
      if (sub.type === 'ass') {
        const transformed = transformAssSubsRecursively(sub as AssSubtitleData);
        if (transformed) {
          newSubtitles.push(transformed);
        }
      } else {
        const sStart = (sub.startTime * ratio) + offset;
        const sEnd = (sub.endTime * ratio) + offset;
        if (sEnd <= 0 || sStart >= duration) {
          continue;
        }

        newSubtitles.push({
          ...sub,
          startTime: AssSubtitlesUtils.roundToAssPrecision(Math.max(0, sStart)),
          endTime: AssSubtitlesUtils.roundToAssPrecision(Math.min(duration, sEnd))
        });
      }
    }

    const updates: Partial<Project> = {subtitles: newSubtitles};
    if (project.rawAssContent) {
      updates.rawAssContent = this.assEditService.transformAllTimings(project.rawAssContent, offset, ratio);
    }

    this.appStateService.updatePartialProject(this._projectId!, updates);
    this._subtitles.set(newSubtitles);
    this.videoStateService.requestAssRendererSync();
  }

  private performAdjust(boundary: 'start' | 'end', direction: 'left' | 'right'): void {
    const currentClip = this.currentClip();
    if (!currentClip || !currentClip.hasSubtitle) {
      return;
    }

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

    this.showMinDurationToastIfNecessary(currentClip, newStartTime, newEndTime);

    const currentSubtitles = this.getSubtitles();
    const potentialNewSubtitles = this.calculateNewSubtitlesForUpdate(currentClip.id, newStartTime, newEndTime);

    if (!potentialNewSubtitles || JSON.stringify(currentSubtitles) === JSON.stringify(potentialNewSubtitles)) {
      return;
    }

    const project = this.appStateService.currentProject();
    const command = new UpdateClipTimesCommand(this, potentialNewSubtitles, project?.rawAssContent);
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
    const clips = this.clipsForAllTracks();
    if (clips.length === 0) {
      return undefined;
    }

    const currentIndex = this.masterClipIndex();
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

  private generateClips(subtitles: SubtitleData[]): VideoClip[] {
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

    // --- O(N log N) Sweep Line optimization ---

    // Map original indices to guarantee 1:1 parity with the old .filter() order
    const originalIndexMap = new Map<string, number>();
    subtitles.forEach((s, i) => originalIndexMap.set(s.id, i));

    const activeSubtitles = new Set<SubtitleData>();
    let subIndex = 0;
    const sortedSubsByStart = [...subtitles].sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < sortedTimestamps.length - 1; i++) {
      const startTime = sortedTimestamps[i];
      const endTime = sortedTimestamps[i + 1];

      // Restoring the original midpoint epsilon logic for perfect mathematical parity
      const midPoint = startTime + 0.001;

      // Add subtitles that have started before or at the midpoint
      while (subIndex < sortedSubsByStart.length && sortedSubsByStart[subIndex].startTime <= midPoint) {
        activeSubtitles.add(sortedSubsByStart[subIndex]);
        subIndex++;
      }

      // Remove subtitles that ended before or at the midpoint
      for (const sub of activeSubtitles) {
        if (sub.endTime <= midPoint) {
          activeSubtitles.delete(sub);
        }
      }

      if (endTime <= startTime) {
        continue;
      }

      segments.push({
        startTime,
        endTime,
        hasSubtitle: activeSubtitles.size > 0,
        // Match the original array's .filter() order
        sourceSubtitles: Array.from(activeSubtitles).sort((a, b) =>
          originalIndexMap.get(a.id)! - originalIndexMap.get(b.id)!
        )
      });
    }

    // Merge adjacent segments that have the exact same set of active subtitles
    const mergedSegments: VideoClip[] = [];
    if (segments.length > 0) {
      let currentSegment = {...segments[0]};

      for (let i = 1; i < segments.length; i++) {
        const nextSegment = segments[i];

        const getCurrentKey = (seg: Partial<VideoClip>): string => {
          if (!seg.hasSubtitle || !seg.sourceSubtitles || seg.sourceSubtitles.length === 0) {
            return 'gap';
          }

          // For ASS, the key is the sorted list of unique parts (style + text)
          const assParts = new Map<string, SubtitlePart>();
          seg.sourceSubtitles.forEach(s => {
            if (s.type === 'ass') {
              s.parts.forEach(p => assParts.set(`${p.style}::${p.text}`, p));
            }
          });
          const sortedAssParts = Array.from(assParts.values()).sort((a, b) => a.style.localeCompare(b.style) || a.text.localeCompare(b.text));
          const assKey = sortedAssParts.map(p => `${p.style}::${p.text}`).join('||');

          // For SRT, the key is the combined text content
          const srtKey = seg.sourceSubtitles
            .filter(s => s.type === 'srt')
            .map(s => (s as SrtSubtitleData).text)
            .join('\\N'); // Use a separator that won't appear in normal text

          // Include splitGroupId in the key
          const splitGroupKey = seg.sourceSubtitles
            .map(s => s.splitGroupId)
            .filter(g => g)
            .sort()
            .join(',');

          // The final key is a combination of all three
          return `${assKey}|${srtKey}|${splitGroupKey}`;
        };

        const currentKey = getCurrentKey(currentSegment);
        const nextKey = getCurrentKey(nextSegment);

        if (currentKey === nextKey) {
          // If visual content is identical, extend current segment
          currentSegment.endTime = nextSegment.endTime;

          // Create Set of existing IDs to avoid duplicates
          const existingIds = new Set(currentSegment.sourceSubtitles!.map(s => s.id));
          let itemsAdded = false;

          nextSegment.sourceSubtitles!.forEach(sub => {
            if (!existingIds.has(sub.id)) {
              currentSegment.sourceSubtitles!.push(sub);
              itemsAdded = true;
            }
          });

          // Re-sort if appended anything
          if (itemsAdded) {
            currentSegment.sourceSubtitles!.sort((a, b) =>
              originalIndexMap.get(a.id)! - originalIndexMap.get(b.id)!
            );
          }
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

    const updatedClips: VideoClip[] = [...originalClips];
    updatedClips[clipIndex] = {...originalClips[clipIndex]};
    const targetClip = updatedClips[clipIndex];
    const oldStartTime = targetClip.startTime;
    const oldEndTime = targetClip.endTime;

    // Determine which handle the user intended to move by seeing which value changed.
    const startHandleMoved = Math.abs(newStartTime - oldStartTime) > 0.001;
    const endHandleMoved = Math.abs(newEndTime - oldEndTime) > 0.001;

    let finalStartTime = newStartTime;
    let finalEndTime = newEndTime;

    // If a handle was not meant to move, restore its original position to fight float errors.
    if (startHandleMoved && !endHandleMoved) {
      finalEndTime = oldEndTime;
    } else if (!startHandleMoved && endHandleMoved) {
      finalStartTime = oldStartTime;
    }

    // Now, enforce minimum duration based on the handle that moved.
    const minDuration = targetClip.hasSubtitle ? MIN_SUBTITLE_DURATION : MIN_GAP_DURATION;
    if (finalEndTime - finalStartTime < minDuration) {
      if (startHandleMoved && !endHandleMoved) { // Left handle moved, right is anchor.
        finalStartTime = finalEndTime - minDuration;
      } else { // Right handle moved, left is anchor (covers inversion case too).
        finalEndTime = finalStartTime + minDuration;
      }
    }

    // Second, handle collisions and interactions with other clips.
    // --- Adjusting START boundary (moving left handle) ---
    if (Math.abs(finalStartTime - oldStartTime) > 0.001) {
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
            updatedClips[i] = {...clip};
            updatedClips[i].endTime = finalStartTime;
            if (updatedClips[i].startTime > updatedClips[i].endTime) updatedClips[i].startTime = updatedClips[i].endTime;
          } else break;
        }
      } else { // Shrinking from the left (moving handle to the right)
        const prevClip = updatedClips[clipIndex - 1];
        if (prevClip && !targetClip.hasSubtitle) {
          updatedClips[clipIndex - 1] = {...prevClip};
          updatedClips[clipIndex - 1].endTime = finalStartTime;
        }
      }
    }

    // --- Adjusting END boundary (moving right handle) ---
    if (Math.abs(finalEndTime - oldEndTime) > 0.001) {
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
            updatedClips[i] = {...clip};
            updatedClips[i].startTime = finalEndTime;
            if (updatedClips[i].endTime < updatedClips[i].startTime) updatedClips[i].endTime = updatedClips[i].startTime;
          } else break;
        }
      } else { // Shrinking from the right (moving handle to the left)
        const nextClip = updatedClips[clipIndex + 1];
        if (nextClip && !targetClip.hasSubtitle) {
          updatedClips[clipIndex + 1] = {...nextClip};
          updatedClips[clipIndex + 1].startTime = finalEndTime;
        }
      }
    }

    targetClip.startTime = finalStartTime;
    targetClip.endTime = finalEndTime;

    // Recalculate duration for all touched clips to be safe
    updatedClips.forEach((c, i) => {
      if (updatedClips[i] !== originalClips[i]) {
        c.duration = c.endTime - c.startTime;
      }
    });

    // Remove zero-duration clips
    return updatedClips.filter(c => c.duration > 0.001);
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
    const originalSubtitlesMap = new Map(originalSubtitles.map(s => [s.id, s]));
    const changedSubtitles = new Map<string, { original: SubtitleData, updated: SubtitleData }>();

    // Helper to recursively update nested ASS dialogues
    const updateAssTimings = (sub: AssSubtitleData, ratio: number, oldClipStart: number, newClipStart: number) => {
      const startOffset = sub.startTime - oldClipStart;
      const endOffset = sub.endTime - oldClipStart;

      const calcStart = newClipStart + (startOffset * ratio);
      const calcEnd = newClipStart + (endOffset * ratio);

      // Apply rounding
      sub.startTime = AssSubtitlesUtils.roundToAssPrecision(calcStart);
      sub.endTime = AssSubtitlesUtils.roundToAssPrecision(calcEnd);

      // Recursively update children
      if (sub.sourceDialogues) {
        sub.sourceDialogues.forEach(child => updateAssTimings(child, ratio, oldClipStart, newClipStart));
      }
    };

    const originalClipsMap = new Map(originalClips.map(c => [c.id, c]));

    updatedClips.forEach(updatedClip => {
      if (!updatedClip.hasSubtitle) {
        return;
      }

      const originalClip = originalClipsMap.get(updatedClip.id);

      if (originalClip && (Math.abs(originalClip.startTime - updatedClip.startTime) > 0.001 || Math.abs(originalClip.endTime - updatedClip.endTime) > 0.001)) {
        for (const sourceSub of updatedClip.sourceSubtitles) {
          const originalSourceSub = originalSubtitlesMap.get(sourceSub.id);
          if (!originalSourceSub) {
            continue;
          }

          const updatedSub = cloneDeep(originalSourceSub);
          const oldDuration = originalClip.duration;

          if (oldDuration > 0.01) { // Avoid division by zero for vanished clips
            const newDuration = updatedClip.duration;
            const durationRatio = newDuration / oldDuration;

            if (updatedSub.type === 'ass') {
              updateAssTimings(updatedSub as AssSubtitleData, durationRatio, originalClip.startTime, updatedClip.startTime);
            } else {
              const startOffset = originalSourceSub.startTime - originalClip.startTime;
              const endOffset = originalSourceSub.endTime - originalClip.startTime;

              // Apply rounding only for modified subtitles
              updatedSub.startTime = AssSubtitlesUtils.roundToAssPrecision(updatedClip.startTime + (startOffset * durationRatio));
              updatedSub.endTime = AssSubtitlesUtils.roundToAssPrecision(updatedClip.startTime + (endOffset * durationRatio));
            }

            // Ensures rounding never pushes the subtitle outside its logical container
            updatedSub.startTime = Math.max(updatedSub.startTime, AssSubtitlesUtils.roundToAssPrecision(updatedClip.startTime));
            updatedSub.endTime = Math.min(updatedSub.endTime, AssSubtitlesUtils.roundToAssPrecision(updatedClip.endTime));
          } else {
            updatedSub.startTime = AssSubtitlesUtils.roundToAssPrecision(updatedClip.startTime);
            updatedSub.endTime = AssSubtitlesUtils.roundToAssPrecision(updatedClip.endTime);
          }

          changedSubtitles.set(updatedSub.id, {original: originalSourceSub, updated: updatedSub});
        }
      }
    });

    return originalSubtitles.map(sub => {
      const change = changedSubtitles.get(sub.id);
      return change ? change.updated : sub;
    });
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
    // Case 1: Split happened chronologically BEFORE the current playhead position (with Ctrl+Click).
    // Since one clip became two, the index of the current clip (where the user is) has shifted by +1.
    if (originalClip.endTime <= currentTime) {
      this._masterClipIndex.update(i => i + 1);
      return;
    }

    // Case 2: Split happened chronologically AFTER the current playhead position (with Ctrl+Click).
    // The current clip's index remains unchanged. No action needed.
    if (originalClip.startTime > currentTime) {
      return;
    }

    // Case 3: Split happened WITHIN the current clip (under the playhead).
    // Logic needs to determine which of the two new parts should become active.
    const EPSILON = 0.001; // Tolerance for floating point comparisons
    const newClipsArray = this.clipsForAllTracks();
    const findLeftPart = () => newClipsArray.find(c => Math.abs(c.endTime - splitPoint) < EPSILON);
    const findRightPart = () => newClipsArray.find(c => Math.abs(c.startTime - (splitPoint + MIN_GAP_DURATION)) < EPSILON);
    const isSplitAtPlayhead = Math.abs(currentTime - splitPoint) < 0.1;
    let newActiveClip: VideoClip | undefined;

    if (isSplitAtPlayhead) {
      if (currentTime < (originalClip.startTime + MIN_SUBTITLE_DURATION - 0.01)) {
        // Case 1: Split was clamped near the START of the original clip.
        // User intended to split early, so keep focus on the first part and don't move the playhead.
        newActiveClip = findLeftPart();
      } else if (currentTime > (originalClip.endTime - MIN_SUBTITLE_DURATION)) {
        // Case 2: Split was clamped near the END of the original clip.
        // User intended to split late, so switch focus to the second part and don't move the playhead.
        newActiveClip = findRightPart();
      } else {
        // Case 3: Normal split in the middle.
        // Focus on the first part and nudge the playhead to its end for a smooth workflow.
        newActiveClip = findLeftPart();
        if (newActiveClip) {
          // Move playhead 50ms before the end of the new clip to stay within its bounds (at 24fps frame is ~41ms).
          const safeSeekTime = Math.max(newActiveClip.startTime, newActiveClip.endTime - 0.05);
          this.videoStateService.seekAbsolute(safeSeekTime);
        }
      }
    } else {
      if (currentTime < splitPoint) {
        newActiveClip = findLeftPart();
      } else {
        newActiveClip = findRightPart();
      }
    }

    if (newActiveClip) {
      const newIndex = newClipsArray.indexOf(newActiveClip);
      if (newIndex !== -1) {
        this.setCurrentClipByIndex(newIndex);
      }
    }
  }

  private showMinDurationToastIfNecessary(clip: VideoClip | undefined, attemptedStartTime: number, attemptedEndTime: number): void {
    const attemptedDuration = attemptedEndTime - attemptedStartTime;

    // If the clip has subtitles and the user's action results in a duration
    // less than the minimum (including negative durations from inversion), show the toast.
    if (clip?.hasSubtitle && attemptedDuration < MIN_SUBTITLE_DURATION) {
      const now = Date.now();
      // Throttle the toast to show it at most once every 3 seconds to avoid spam during dragging or key-repeats.
      if (now - this.lastMinDurationToastTime > 3000) {
        this.toastService.info(`A subtitled clip cannot be shorter than ${MIN_SUBTITLE_DURATION} seconds`);
        this.lastMinDurationToastTime = now;
      }
    }
  }

  private getAggregatedClipNotes(subtitleIds: string[], allProjectNotes: Record<string, ProjectClipNotes>): ProjectClipNotes {
    const aggregated: ProjectClipNotes = {lookupNotes: {}, manualNote: '', hint: ''};

    for (const id of subtitleIds) {
      const notes = allProjectNotes[id];
      if (!notes) continue;

      // Merge manual note (first non-empty wins)
      if (!aggregated.manualNote && notes.manualNote) {
        aggregated.manualNote = notes.manualNote;
      }

      // Merge hint (first non-empty wins)
      if (!aggregated.hint && notes.hint) {
        aggregated.hint = notes.hint;
      }

      // Merge notes
      if (notes.lookupNotes) {
        for (const [term, definitions] of Object.entries(notes.lookupNotes)) {
          if (!aggregated.lookupNotes![term]) {
            aggregated.lookupNotes![term] = [];
          }
          // Combine and deduplicate
          const currentSet = new Set(aggregated.lookupNotes![term]);
          for (const def of definitions) {
            if (!currentSet.has(def)) {
              aggregated.lookupNotes![term].push(def);
              currentSet.add(def);
            }
          }
        }
      }
    }

    return aggregated;
  }

  private trimSubtitleToBoundaries(sub: SubtitleData, start: number, end: number): SubtitleData | null {
    // If the subtitle is completely outside the new boundaries, it's dead
    if (sub.endTime <= start || sub.startTime >= end) {
      return null;
    }

    const trimmed = cloneDeep(sub);
    trimmed.startTime = Math.max(trimmed.startTime, start);
    trimmed.endTime = Math.min(trimmed.endTime, end);

    // If it's ASS and has nested dialogues, trim those too
    if (trimmed.type === 'ass' && trimmed.sourceDialogues) {
      trimmed.sourceDialogues = trimmed.sourceDialogues
        .map(s => this.trimSubtitleToBoundaries(s, start, end))
        .filter((s): s is AssSubtitleData => s !== null);
    }

    return trimmed;
  }
}
