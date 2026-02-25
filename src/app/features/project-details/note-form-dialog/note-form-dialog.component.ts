import {ChangeDetectionStrategy, Component, inject, OnInit} from '@angular/core';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {Button} from 'primeng/button';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {InputText} from 'primeng/inputtext';
import {Textarea} from 'primeng/textarea';
import {NoteFormDialogData, NoteFormResult} from './note-form-dialog.types';
import {FormControlErrorComponent} from '../../../shared/components/form-control-error/form-control-error.component';
import {FormValidationService} from '../../../core/services/form-validation/form-validation.service';
import {CustomValidators} from '../../../shared/validators/validators';

@Component({
  selector: 'app-note-form-dialog',
  imports: [
    ReactiveFormsModule,
    Button,
    InputText,
    Textarea,
    FormControlErrorComponent
  ],
  templateUrl: './note-form-dialog.component.html',
  styleUrl: './note-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NoteFormDialogComponent implements OnInit {
  protected form!: FormGroup;
  protected data!: NoteFormDialogData;
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly fb = inject(FormBuilder);
  private readonly formValidationService = inject(FormValidationService);

  ngOnInit(): void {
    this.data = this.config.data as NoteFormDialogData;
    const isRename = (this.data.mode === 'rename-term');

    this.form = this.fb.group({
      term: [this.data.term, [Validators.maxLength(255)]],
      noteText: [this.data.noteText || '', isRename ? [] : [Validators.required, CustomValidators.notBlank(), Validators.maxLength(5000)]]
    });

    if (!this.data.isTermEditable) {
      this.form.get('term')?.disable();
    }
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    const result: NoteFormResult = {
      term: (this.form.getRawValue().term || '').trim(),
      noteText: this.data.mode === 'rename-term' ? undefined : this.form.getRawValue().noteText
    };

    this.ref.close(result);
  }
}
