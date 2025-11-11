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
import {cloneDeep, isEqual} from 'lodash-es';
import {v4 as uuidv4} from 'uuid';
import {AssSubtitlesUtils} from '../../../../shared/utils/ass-subtitles.utils';

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
  private readonly _activeTrack = signal(0);
  private readonly _masterClipIndex = signal(0); // Track master clip index, works across flattened and merged collection of video clips
  private readonly _activeTrackClipIndex = signal(0); // Clip index on currently active track
  private readonly _playerState = signal<PlayerState>(PlayerState.Idle);
  private adjustDebounceTimer: any;
  private _projectId: string | null = null;
  private readonly cleanupPlaybackListener: (() => void) | null = null;
  private lastMinDurationToastTime = 0;

  public readonly activeTrack = this._activeTrack.asReadonly();
  public readonly masterClipIndex = this._masterClipIndex.asReadonly();
  public readonly activeTrackClipIndex = this._activeTrackClipIndex.asReadonly();
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
      const trackClips = this.clips();
      const currentTime = this.videoStateService.currentTime();

      if (trackClips.length === 0) {
        this._activeTrackClipIndex.set(-1);
        return;
      }

      const newActiveIndex = trackClips.findIndex(c => currentTime >= c.startTime && currentTime < c.endTime);
      this._activeTrackClipIndex.set(newActiveIndex);
    });

    effect(() => {
      const currentClips = this.clipsForAllTracks();
      if (currentClips.length > 0) {
        window.electronAPI.playbackUpdateClips(currentClips);
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

    this.appStateService.updateProject(this._projectId!, updates);
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

    const project = this.appStateService.currentProject();
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

    const project = this.appStateService.currentProject();
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
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

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
    const newClipsArray = this.clipsForAllTracks();
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
      const currentIndex = this.activeTrackClipIndex();
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

    this.appStateService.updateProject(this._projectId!, updates);
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

  public mergeClips(
    firstClipId: string,
    secondClipId: string,
    onMergeCallback?: (originalFirstSubtitles: SubtitleData[], deletedSecondSubtitles: SubtitleData[]) => void
  ): void {
    const project = this.appStateService.currentProject();
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

    const newClipsArray = this.clipsForAllTracks();
    const newCorrectIndex = newClipsArray.findIndex(c =>
      midpoint >= c.startTime && midpoint < c.endTime
    );

    if (newCorrectIndex !== -1) {
      this._masterClipIndex.set(newCorrectIndex);
    }
  }

  public unmergeClips(
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

    this.appStateService.updateProject(this._projectId!, updates);
    this._subtitles.set(restoredSubtitles);
  }

  public createNewSubtitledClipAtCurrentTime(): void {
    const currentClip = this.currentClip();
    const project = this.appStateService.currentProject();
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

    this.appStateService.updateProject(this._projectId!, updates);
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

    this.appStateService.updateProject(this._projectId!, updates);
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

    this.appStateService.updateProject(project.id, updates);
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
          const assKey = sortedAssParts.map(p => `${p.style}::${p.text}`).join('||');

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
    // Remove zero-duration clips and round all values at the very end
    return updatedClips.filter(c => c.duration > 0.001).map(c => ({
      ...c,
      startTime: AssSubtitlesUtils.roundToAssPrecision(c.startTime),
      endTime: AssSubtitlesUtils.roundToAssPrecision(c.endTime),
      duration: AssSubtitlesUtils.roundToAssPrecision(c.endTime - c.startTime)
    }));
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

      if (originalClip && (Math.abs(originalClip.startTime - updatedClip.startTime) > 0.001 || Math.abs(originalClip.endTime - updatedClip.endTime) > 0.001)) {
        for (const sourceSub of updatedClip.sourceSubtitles) {
          const originalSourceSub = originalSubtitles.find(s => s.id === sourceSub.id);
          if (!originalSourceSub) continue;

          const updatedSub = cloneDeep(originalSourceSub);
          const oldDuration = originalClip.duration;

          if (oldDuration > 0.01) { // Avoid division by zero for vanished clips
            const newDuration = updatedClip.duration;
            const startRatio = (originalSourceSub.startTime - originalClip.startTime) / oldDuration;
            const endRatio = (originalSourceSub.endTime - originalClip.startTime) / oldDuration;
            updatedSub.startTime = updatedClip.startTime + (startRatio * newDuration);
            updatedSub.endTime = updatedClip.startTime + (endRatio * newDuration);
          } else {
            // If original clip had no duration, just clamp the sub to the new clip times
            updatedSub.startTime = updatedClip.startTime;
            updatedSub.endTime = updatedClip.endTime;
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
    const newClipsArray = this.clipsForAllTracks();
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

  private showMinDurationToastIfNecessary(clip: VideoClip | undefined, attemptedStartTime: number, attemptedEndTime: number): void {
    const attemptedDuration = attemptedEndTime - attemptedStartTime;

    // If the clip has subtitles and the user's action results in a duration
    // less than the minimum (including negative durations from inversion), show the toast.
    if (clip?.hasSubtitle && attemptedDuration < MIN_SUBTITLE_DURATION) {
      const now = Date.now();
      // Throttle the toast to show it at most once every 3 seconds to avoid spam during dragging or key-repeats.
      if (now - this.lastMinDurationToastTime > 3000) {
        this.toastService.info(`A subtitled clip cannot be shorter than ${MIN_SUBTITLE_DURATION} seconds.`);
        this.lastMinDurationToastTime = now;
      }
    }
  }
}
