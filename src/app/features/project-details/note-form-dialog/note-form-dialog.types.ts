export interface NoteFormDialogData {
  mode: 'create' | 'edit' | 'rename-term';
  term: string;
  noteText: string;
  isTermEditable: boolean;
}

export interface NoteFormResult {
  term: string;
  noteText: string;
}
