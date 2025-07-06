import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';

export class UpdateClipTextCommand implements Command {
  constructor(
    private clipsStateService: ClipsStateService,
    private clipId: string,
    private oldText: string,
    private newText: string
  ) {
  }

  execute(): void {
    this.clipsStateService.updateClipText(this.clipId, this.newText);
  }

  undo(): void {
    this.clipsStateService.updateClipText(this.clipId, this.oldText);
  }
}
