import {ShiftValidationResult} from '../../../state/clips/clips-state.service';

export interface SubtitleOffsetDialogData {
  validate: (offset: number, ratio: number) => ShiftValidationResult;
  apply: (offset: number, ratio: number) => void;
}
