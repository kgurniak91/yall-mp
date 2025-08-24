import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class MergeSubtitledClipsCommand implements Command {
  private originalFirstSubtitle: SubtitleData | undefined;
  private originalSecondSubtitle: SubtitleData | undefined;

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
        this.originalFirstSubtitle = JSON.parse(JSON.stringify(originalFirstSubtitle));
        this.originalSecondSubtitle = JSON.parse(JSON.stringify(deletedSecondSubtitle));
      }
    );
  }

  undo(): void {
    if (!this.originalFirstSubtitle || !this.originalSecondSubtitle) {
      console.error("Cannot undo merge: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unmergeClips(
      this.originalFirstSubtitle,
      this.originalSecondSubtitle
    );
  }
}
