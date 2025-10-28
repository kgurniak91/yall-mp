import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';
import type {VideoClip} from '../video.types';

export class DeleteSubtitledClipCommand implements Command {
  private originalSubtitles: SubtitleData[] = [];
  private originalRawAssContent?: string;

  constructor(
    private clipsStateService: ClipsStateService,
    private clipToDelete: VideoClip
  ) {
  }

  execute(): void {
    const originalState = this.clipsStateService.deleteClip(this.clipToDelete);
    if (originalState) {
      this.originalSubtitles = originalState.originalSubtitles;
      this.originalRawAssContent = originalState.originalRawAssContent;
    }
  }

  undo(): void {
    if (this.originalSubtitles.length > 0) {
      this.clipsStateService.restoreSubtitles(this.originalSubtitles, this.originalRawAssContent);
    } else {
      console.error('Cannot undo delete: original state was not captured.');
    }
  }
}
