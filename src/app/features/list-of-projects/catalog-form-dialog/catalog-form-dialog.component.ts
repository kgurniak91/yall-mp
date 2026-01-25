import {ChangeDetectionStrategy, Component, inject, OnInit, signal} from '@angular/core';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {Button} from 'primeng/button';
import {InputText} from 'primeng/inputtext';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormControlErrorComponent} from '../../../shared/components/form-control-error/form-control-error.component';
import {Catalog} from '../../../model/project.types';
import {AppStateService} from '../../../state/app/app-state.service';
import {CustomValidators} from '../../../shared/validators/validators';
import {FormValidationService} from '../../../core/services/form-validation/form-validation.service';

export interface CatalogFormDialogData {
  mode: 'create' | 'edit';
  parentId: string;
  catalog?: Catalog;
}

@Component({
  selector: 'app-catalog-form-dialog',
  imports: [
    ReactiveFormsModule,
    Button,
    InputText,
    FormControlErrorComponent
  ],
  templateUrl: './catalog-form-dialog.component.html',
  styleUrl: './catalog-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogFormDialogComponent implements OnInit {
  protected form!: FormGroup;
  protected isEditMode = signal<boolean>(false);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly appStateService = inject(AppStateService);
  private readonly formValidationService = inject(FormValidationService);
  private data!: CatalogFormDialogData;

  ngOnInit() {
    this.data = this.config.data;
    this.isEditMode.set(this.data.mode === 'edit');

    this.form = this.fb.group({
      name: [
        this.data.catalog?.name || '',
        [Validators.required, CustomValidators.notBlank(), Validators.maxLength(50)]
      ]
    });
  }

  onSave() {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    const nameFC = this.form.get('name');
    const name = nameFC?.value.trim();
    const parentId = this.data.parentId;
    const currentId = this.data.catalog?.id;
    const isTaken = this.appStateService.isCatalogNameTaken(name, parentId, currentId);

    if (isTaken) {
      nameFC?.setErrors({nameTaken: true});
      nameFC?.markAsDirty();
      return;
    }

    this.ref.close(name);
  }

  onCancel() {
    this.ref.close();
  }
}
