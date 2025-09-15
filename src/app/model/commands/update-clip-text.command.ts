import {Command} from './commands.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {SubtitlePart} from '../../../../shared/types/subtitle.type';
import {VideoClip} from '../video.types';

export interface ClipContent {
  text?: string;
  parts?: SubtitlePart[];
}

export class UpdateClipTextCommand implements Command {
  constructor(
    private clipsStateService: ClipsStateService,
    private projectId: string,
    private clip: VideoClip,
    private oldContent: ClipContent,
    private newContent: ClipContent,
  ) {
  }

  execute(): void {
    this.clipsStateService.updateClipText(this.projectId, this.clip, this.newContent);
  }

  undo(): void {
    this.clipsStateService.updateClipText(this.projectId, this.clip, this.oldContent);
  }
}
