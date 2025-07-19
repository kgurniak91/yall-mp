import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';

export class SplitSubtitledClipCommand implements Command {
  private newSubtitleId: string | undefined;
  private originalText: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipIdToSplit: string
  ) {
  }

  execute(): void {
    this.clipsStateService.splitSubtitledClip(
      this.clipIdToSplit,
      (originalText, newlyCreatedSubtitleId) => {
        this.originalText = originalText;
        this.newSubtitleId = newlyCreatedSubtitleId;
      }
    );
  }

  undo(): void {
    if (!this.newSubtitleId || this.originalText === undefined) {
      console.error("Cannot undo split: original text or new subtitle ID was not captured.");
      return;
    }

    this.clipsStateService.mergeClips(
      this.clipIdToSplit,
      this.newSubtitleId,
      undefined, // No onMerge callback needed for undo
      this.originalText // Pass the original text to restore
    );
  }
}
