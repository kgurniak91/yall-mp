import {Component, inject, OnInit} from '@angular/core';
import {Textarea} from 'primeng/textarea';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {EditNoteDialogConfig} from './edit-note-dialog.types';

@Component({
  selector: 'app-edit-note-dialog',
  imports: [
    Textarea,
    FormsModule,
    Button
  ],
  templateUrl: './edit-note-dialog.component.html',
  styleUrl: './edit-note-dialog.component.scss'
})
export class EditNoteDialogComponent implements OnInit {
  protected editedNoteText = '';
  private originalText = '';
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);

  ngOnInit(): void {
    const data = this.config.data as EditNoteDialogConfig;
    this.originalText = data?.noteText || '';
    this.editedNoteText = this.originalText;
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (this.editedNoteText !== this.originalText) {
      this.ref.close(this.editedNoteText);
    } else {
      this.ref.close();
    }
  }
}
