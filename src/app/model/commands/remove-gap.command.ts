import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class RemoveGapCommand implements Command {
  private originalFirstSubtitles: SubtitleData[] = [];
  private originalSecondSubtitles: SubtitleData[] = [];

  constructor(
    private clipsStateService: ClipsStateService,
    private firstClipId: string,
    private secondClipId: string
  ) {
  }

  execute(): void {
    this.clipsStateService.removeGap(
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
      console.error("Cannot restore gap: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.restoreGap(
      this.originalFirstSubtitles,
      this.originalSecondSubtitles
    );
  }
}
