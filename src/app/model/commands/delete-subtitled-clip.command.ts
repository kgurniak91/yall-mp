import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class DeleteSubtitledClipCommand implements Command {
  private deletedSubtitles: SubtitleData[] = [];
  private originalIndexes: number[] = [];

  constructor(
    private clipsStateService: ClipsStateService,
    private subtitleIdsToDelete: string[]
  ) {
  }

  execute(): void {
    const result = this.clipsStateService.deleteSubtitles(this.subtitleIdsToDelete);
    if (result) {
      this.deletedSubtitles = result.deletedSubtitles;
      this.originalIndexes = result.originalIndexes;
    }
  }

  undo(): void {
    if (this.deletedSubtitles.length > 0 && this.originalIndexes.length > 0) {
      this.clipsStateService.insertSubtitle(this.deletedSubtitles, this.originalIndexes);
    } else {
      console.error("Cannot undo delete: original subtitle data was not captured.");
    }
  }
}
