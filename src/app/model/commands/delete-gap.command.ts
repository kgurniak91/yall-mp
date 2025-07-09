import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';

export class DeleteGapCommand implements Command {
  private originalSecondCue: VTTCue | undefined;
  private originalFirstCueEndTime: number | undefined;
  private originalFirstCueText: string | undefined;

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
      (originalFirstCue, deletedSecondCue) => {
        this.originalFirstCueEndTime = originalFirstCue.endTime;
        this.originalFirstCueText = originalFirstCue.text;
        this.originalSecondCue = new VTTCue(
          deletedSecondCue.startTime,
          deletedSecondCue.endTime,
          deletedSecondCue.text
        );
        this.originalSecondCue.id = deletedSecondCue.id;
      }
    );
  }

  undo(): void {
    if (!this.originalSecondCue || this.originalFirstCueEndTime === undefined || this.originalFirstCueText === undefined) {
      console.error("Cannot undo merge: original cue data was not captured.");
      return;
    }

    this.clipsStateService.unmergeClips(
      this.firstClipId,
      this.originalFirstCueEndTime,
      this.originalFirstCueText,
      this.originalSecondCue
    );
  }
}
