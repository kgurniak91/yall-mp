import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';

export class DeleteSubtitledClipCommand implements Command {
  private deletedSubtitle: SubtitleData | undefined;
  private originalIndex: number | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private subtitleIdToDelete: string
  ) {
  }

  execute(): void {
    const result = this.clipsStateService.deleteSubtitle(this.subtitleIdToDelete);
    if (result) {
      this.deletedSubtitle = result.deletedSubtitle;
      this.originalIndex = result.originalIndex;
    }
  }

  undo(): void {
    if (this.deletedSubtitle && this.originalIndex !== undefined) {
      this.clipsStateService.insertSubtitle(this.deletedSubtitle, this.originalIndex);
    } else {
      console.error("Cannot undo delete: original subtitle data was not captured.");
    }
  }
}
