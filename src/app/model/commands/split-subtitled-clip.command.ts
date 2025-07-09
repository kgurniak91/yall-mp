import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';

export class SplitSubtitledClipCommand implements Command {
  private newCueId: string | undefined;
  private originalText: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipIdToSplit: string
  ) {
  }

  execute(): void {
    this.clipsStateService.splitClip(
      this.clipIdToSplit,
      (originalText, newlyCreatedCueId) => {
        this.originalText = originalText;
        this.newCueId = newlyCreatedCueId;
      }
    );
  }

  undo(): void {
    if (!this.newCueId || this.originalText === undefined) {
      console.error("Cannot undo split: original text or new cue ID was not captured.");
      return;
    }

    this.clipsStateService.mergeClips(
      this.clipIdToSplit,
      this.newCueId,
      undefined, // No onMerge callback needed for undo
      this.originalText // Pass the original text to restore
    );
  }
}
