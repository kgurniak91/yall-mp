import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';
import {ProjectClipNotes} from '../project.types';

export class SplitSubtitledClipCommand implements Command {
  private originalSubtitles: SubtitleData[] | undefined;
  private newSubtitleIds: string[] | undefined;
  private originalRawAssContent: string | undefined;
  private originalNotes: Record<string, ProjectClipNotes> | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipIdToSplit: string,
    rawAssContent?: string,
    private splitTime?: number
  ) {
    this.originalRawAssContent = rawAssContent;
  }

  execute(): void {
    this.clipsStateService.splitSubtitledClip(
      this.clipIdToSplit,
      this.splitTime,
      (originalSubtitles, newlyCreatedSubtitleIds, originalNotes) => {
        this.originalSubtitles = originalSubtitles;
        this.newSubtitleIds = newlyCreatedSubtitleIds;
        this.originalNotes = originalNotes;
      }
    );
  }

  undo(): void {
    if (!this.originalSubtitles || !this.newSubtitleIds) {
      console.error("Cannot undo split: original subtitle data was not captured.");
      return;
    }

    this.clipsStateService.unsplitClip(
      this.originalSubtitles,
      this.newSubtitleIds,
      this.originalRawAssContent,
      this.originalNotes
    );
  }
}
