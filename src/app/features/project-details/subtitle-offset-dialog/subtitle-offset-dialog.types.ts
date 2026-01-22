import {ShiftValidationResult} from '../../../state/clips/clips-state.service';

export interface SubtitleOffsetDialogData {
  validate: (offset: number) => ShiftValidationResult;
  apply: (offset: number) => void;
}
