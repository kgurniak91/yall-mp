import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';

export class UpdateClipTimesCommand implements Command {
  constructor(
    private clipsStateService: ClipsStateService,
    private clipId: string,
    private oldStartTime: number,
    private oldEndTime: number,
    private newStartTime: number,
    private newEndTime: number
  ) {
  }

  execute(): void {
    this.clipsStateService.updateClipTimes(this.clipId, this.newStartTime, this.newEndTime);
  }

  undo(): void {
    this.clipsStateService.updateClipTimes(this.clipId, this.oldStartTime, this.oldEndTime);
  }
}
