import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitlePart} from '../../../../shared/types/subtitle.type';

export interface ClipContent {
  text?: string;
  parts?: SubtitlePart[];
}

export class UpdateClipTextCommand implements Command {
  constructor(
    private clipsStateService: ClipsStateService,
    private projectId: string,
    private clipId: string,
    private oldContent: ClipContent,
    private newContent: ClipContent,
  ) {
  }

  execute(): void {
    this.clipsStateService.updateClipText(this.projectId, this.clipId, this.newContent);
  }

  undo(): void {
    this.clipsStateService.updateClipText(this.projectId, this.clipId, this.oldContent);
  }
}
