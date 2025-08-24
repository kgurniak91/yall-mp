import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';

export class SplitSubtitledClipCommand implements Command {
  private originalSubtitle: SubtitleData | undefined;
  private newSubtitleId: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipIdToSplit: string
  ) {
  }

  execute(): void {
    this.clipsStateService.splitSubtitledClip(
      this.clipIdToSplit,
      (originalSubtitle, newlyCreatedSubtitleId) => {
        this.originalSubtitle = originalSubtitle;
        this.newSubtitleId = newlyCreatedSubtitleId;
      }
    );
  }

  undo(): void {
    if (!this.originalSubtitle || !this.newSubtitleId) {
      console.error("Cannot undo split: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unsplitClip(
      this.originalSubtitle,
      this.newSubtitleId
    );
  }
}
