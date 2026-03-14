import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';
import {ProjectClipNotes} from '../project.types';

export class MergeSubtitlesCommand implements Command {
  public readonly label = 'Merge Subtitles';
  private originalSubtitles: SubtitleData[] = [];
  private newMergedSubtitleId: string | undefined;
  private originalNotes: Record<string, ProjectClipNotes> = {};

  constructor(
    private clipsStateService: ClipsStateService,
    private gapClipId: string
  ) {
  }

  execute(): void {
    this.clipsStateService.mergeSubtitles(
      this.gapClipId,
      (originalSubs, newMergedId, originalNotes) => {
        this.originalSubtitles = originalSubs;
        this.newMergedSubtitleId = newMergedId;
        this.originalNotes = originalNotes;
      }
    );
  }

  undo(): void {
    if (this.originalSubtitles.length === 0 || !this.newMergedSubtitleId) {
      console.error('Cannot undo merge subtitles: original data was not captured.');
      return;
    }

    this.clipsStateService.unmergeSubtitles(
      this.originalSubtitles,
      this.newMergedSubtitleId,
      this.originalNotes
    );
  }
}
