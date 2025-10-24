import {Component, inject, OnInit} from '@angular/core';
import {Textarea} from 'primeng/textarea';
import {FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {Button} from 'primeng/button';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {EditNoteDialogConfig} from './edit-note-dialog.types';
import {FormControlErrorComponent} from "../../../../shared/components/form-control-error/form-control-error.component";
import {CustomValidators} from '../../../../shared/validators/validators';
import {FormValidationService} from '../../../../core/services/form-validation/form-validation.service';

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
  protected form!: FormGroup;
  private originalText = '';
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly fb = inject(FormBuilder);
  private readonly formValidationService = inject(FormValidationService);

  get noteControl(): FormControl {
    return this.form.get('note') as FormControl;
  }

  ngOnInit(): void {
    const data = this.config.data as EditNoteDialogConfig;
    this.originalText = data?.noteText || '';
    this.form = this.fb.group({
      note: [this.originalText, {
        nonNullable: true,
        validators: [Validators.required, CustomValidators.notBlank(), Validators.maxLength(5000)]
      }]
    });
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    const newNoteValue = this.form.value.note;
    if (newNoteValue !== this.originalText) {
      this.ref.close(newNoteValue);
    } else {
      this.ref.close();
    }
  }
}
