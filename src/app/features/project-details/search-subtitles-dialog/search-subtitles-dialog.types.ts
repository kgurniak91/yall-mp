import {VideoClip} from '../../../model/video.types';

export interface SearchSubtitlesDialogData {
  clips: VideoClip[];
  currentTime: number;
}
