import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';

export class CreateSubtitledClipCommand implements Command {
  private addedSubtitleId: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private newSubtitle: SubtitleData
  ) {
    this.addedSubtitleId = newSubtitle.id;
  }

  execute(): void {
    this.clipsStateService.addSubtitle(this.newSubtitle);
  }

  undo(): void {
    if (this.addedSubtitleId) {
      this.clipsStateService.deleteSubtitles([this.addedSubtitleId]);
    } else {
      console.error("Cannot undo add: subtitle ID was not captured.");
    }
  }
}
