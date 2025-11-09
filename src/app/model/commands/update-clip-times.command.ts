import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';
import {cloneDeep} from 'lodash-es';

export class UpdateClipTimesCommand implements Command {
  private readonly originalSubtitles: SubtitleData[];
  private readonly newSubtitles: SubtitleData[];
  private readonly originalRawAssContent?: string;

  constructor(
    private clipsStateService: ClipsStateService,
    newSubtitles: SubtitleData[],
    originalRawAssContent?: string
  ) {
    this.originalSubtitles = cloneDeep(this.clipsStateService.getSubtitles());
    this.newSubtitles = newSubtitles;
    this.originalRawAssContent = originalRawAssContent;
  }

  execute(): void {
    this.clipsStateService.applySubtitleUpdates(this.newSubtitles);
  }

  undo(): void {
    this.clipsStateService.restoreSubtitles(this.originalSubtitles, this.originalRawAssContent);
  }
}
