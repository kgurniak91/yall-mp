import {Component, inject, OnInit} from '@angular/core';
import {Textarea} from 'primeng/textarea';
import {FormControl, ReactiveFormsModule, Validators} from '@angular/forms';
import {Button} from 'primeng/button';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {EditNoteDialogConfig} from './edit-note-dialog.types';
import {ToastService} from "../../../../shared/services/toast/toast.service";
import {FormControlErrorComponent} from "../../../../shared/components/form-control-error/form-control-error.component";
import {CustomValidators} from '../../../../shared/validators/validators';

@Component({
  selector: 'app-edit-note-dialog',
  imports: [
    Textarea,
    ReactiveFormsModule,
    Button,
    FormControlErrorComponent
  ],
  templateUrl: './edit-note-dialog.component.html',
  styleUrl: './edit-note-dialog.component.scss'
})
export class EditNoteDialogComponent implements OnInit {
  protected noteControl!: FormControl<string>;
  private originalText = '';
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly toastService = inject(ToastService);

  ngOnInit(): void {
    const data = this.config.data as EditNoteDialogConfig;
    this.originalText = data?.noteText || '';
    this.noteControl = new FormControl(this.originalText, {
      nonNullable: true,
      validators: [Validators.required, CustomValidators.notBlank(), Validators.maxLength(5000)]
    });
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (this.noteControl.invalid) {
      this.noteControl.markAsTouched();
      this.toastService.warn('Note cannot be empty or exceed 5000 characters.');
      return;
    }

    if (this.noteControl.value !== this.originalText) {
      this.ref.close(this.noteControl.value);
    } else {
      this.ref.close();
    }
  }
}
