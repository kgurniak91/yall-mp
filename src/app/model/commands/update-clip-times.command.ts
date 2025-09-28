import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {AssSubtitlesUtils} from '../../shared/utils/ass-subtitles/ass-subtitles.utils';

export class UpdateClipTimesCommand implements Command {
  constructor(
    private clipsStateService: ClipsStateService,
    private sourceSubtitleIds: string[],
    private oldStartTime: number,
    private oldEndTime: number,
    private newStartTime: number,
    private newEndTime: number,
    private volatileClipId?: string // Optional: for gaps
  ) {
    this.oldStartTime = AssSubtitlesUtils.roundToAssPrecision(oldStartTime);
    this.oldEndTime = AssSubtitlesUtils.roundToAssPrecision(oldEndTime);
    this.newStartTime = AssSubtitlesUtils.roundToAssPrecision(newStartTime);
    this.newEndTime = AssSubtitlesUtils.roundToAssPrecision(newEndTime);
  }

  execute(): void {
    this.clipsStateService.updateClipTimes(this.sourceSubtitleIds, this.newStartTime, this.newEndTime, this.volatileClipId);
  }

  undo(): void {
    this.clipsStateService.updateClipTimes(this.sourceSubtitleIds, this.oldStartTime, this.oldEndTime, this.volatileClipId);
  }
}
