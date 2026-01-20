import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';

export class MergeSubtitlesCommand implements Command {
  private originalSubtitles: SubtitleData[] = [];

  constructor(
    private clipsStateService: ClipsStateService,
    private gapClipId: string
  ) {
  }

  execute(): void {
    this.clipsStateService.mergeSubtitles(
      this.gapClipId,
      (originalSubs) => {
        this.originalSubtitles = originalSubs;
      }
    );
  }

  undo(): void {
    if (this.originalSubtitles.length === 0) {
      console.error('Cannot undo merge subtitles: original data was not captured.');
      return;
    }

    this.clipsStateService.unmergeSubtitles(this.originalSubtitles);
  }
}
