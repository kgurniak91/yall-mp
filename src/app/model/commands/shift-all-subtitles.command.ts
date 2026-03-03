import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitleData} from '../../../../shared/types/subtitle.type';
import {cloneDeep} from 'lodash-es';

export class ShiftAllSubtitlesCommand implements Command {
  public readonly label = 'Global Subtitles Transform';
  private readonly originalSubtitles: SubtitleData[];
  private readonly originalRawAssContent: string | undefined;

  constructor(
    private clipsStateService: ClipsStateService,
    private offsetSeconds: number,
    private ratio: number,
    rawAssContent?: string
  ) {
    this.originalSubtitles = cloneDeep(this.clipsStateService.getSubtitles());
    this.originalRawAssContent = rawAssContent;
  }

  execute(): void {
    this.clipsStateService.performGlobalTransform(this.offsetSeconds, this.ratio);
  }

  undo(): void {
    this.clipsStateService.restoreSubtitles(this.originalSubtitles, this.originalRawAssContent);
  }
}
