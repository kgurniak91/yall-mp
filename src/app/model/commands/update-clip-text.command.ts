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
    const clip = this.getClip();
    if (clip) {
      this.clipsStateService.updateClipText(this.projectId, clip, this.newContent);
    }
  }

  undo(): void {
    const clip = this.getClip();
    if (clip) {
      this.clipsStateService.updateClipText(this.projectId, clip, this.oldContent);
    }
  }

  private getClip() {
    return this.clipsStateService.clips().find(c => c.id === this.clipId);
  }
}
