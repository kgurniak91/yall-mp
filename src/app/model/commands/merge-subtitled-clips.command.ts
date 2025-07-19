import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class MergeSubtitledClipsCommand implements Command {
  private originalSecondSubtitle: SubtitleData | undefined;
  private originalFirstSubtitleEndTime: number | undefined;
  private originalFirstSubtitleText: string | undefined;

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
      (originalFirstSubtitle, deletedSecondSubtitle) => {
        this.originalFirstSubtitleEndTime = originalFirstSubtitle.endTime;
        this.originalFirstSubtitleText = originalFirstSubtitle.text;
        this.originalSecondSubtitle = {...deletedSecondSubtitle};
      }
    );
  }

  undo(): void {
    if (!this.originalSecondSubtitle || this.originalFirstSubtitleEndTime === undefined || this.originalFirstSubtitleText === undefined) {
      console.error("Cannot undo merge: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unmergeClips(
      this.firstClipId,
      this.originalFirstSubtitleEndTime,
      this.originalFirstSubtitleText,
      this.originalSecondSubtitle
    );
  }
}
