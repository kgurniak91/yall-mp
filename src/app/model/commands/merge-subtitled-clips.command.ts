import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class MergeSubtitledClipsCommand implements Command {
  private originalFirstSubtitles: SubtitleData[] = [];
  private originalSecondSubtitles: SubtitleData[] = [];

  constructor(
    private clipsStateService: ClipsStateService,
    private firstClipId: string,
    private secondClipId: string
  ) {
  }

  execute(): void {
    this.clipsStateService.mergeClips(
      this.firstClipId,
      this.secondClipId,
      (originalFirsts, deletedSeconds) => {
        this.originalFirstSubtitles = originalFirsts;
        this.originalSecondSubtitles = deletedSeconds;
      }
    );
  }

  undo(): void {
    if (this.originalFirstSubtitles.length === 0 || this.originalSecondSubtitles.length === 0) {
      console.error("Cannot undo merge: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unmergeClips(
      this.originalFirstSubtitles,
      this.originalSecondSubtitles
    );
  }
}
