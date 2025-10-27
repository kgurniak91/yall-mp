import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';

export class SplitSubtitledClipCommand implements Command {
  private originalSubtitles: SubtitleData[] | undefined;
  private newSubtitleIds: string[] | undefined;
  private originalRawAssContent: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipIdToSplit: string,
    rawAssContent?: string
  ) {
    this.originalRawAssContent = rawAssContent;
  }

  execute(): void {
    this.clipsStateService.splitSubtitledClip(
      this.clipIdToSplit,
      (originalSubtitles, newlyCreatedSubtitleIds) => {
        this.originalSubtitles = originalSubtitles;
        this.newSubtitleIds = newlyCreatedSubtitleIds;
      }
    );
  }

  undo(): void {
    if (!this.originalSubtitles || !this.newSubtitleIds) {
      console.error("Cannot undo split: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unsplitClip(
      this.originalSubtitles,
      this.newSubtitleIds,
      this.originalRawAssContent
    );
  }
}
