export interface NoteFormDialogData {
  mode: 'create' | 'edit';
  term: string;
  noteText: string;
  isTermEditable: boolean;
}

export interface NoteFormResult {
  term: string;
  noteText: string;
}
