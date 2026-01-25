import {ChangeDetectionStrategy, Component, inject, OnInit} from '@angular/core';
import {Button} from 'primeng/button';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {CatalogSelectComponent} from '../../../shared/components/catalog-select/catalog-select.component';
import {FormControlErrorComponent} from '../../../shared/components/form-control-error/form-control-error.component';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {FormValidationService} from '../../../core/services/form-validation/form-validation.service';
import {MoveProjectDialogData} from './move-project-dialog.types';

@Component({
  selector: 'app-move-project-dialog',
  imports: [
    Button,
    CatalogSelectComponent,
    FormControlErrorComponent,
    ReactiveFormsModule
  ],
  templateUrl: './move-project-dialog.component.html',
  styleUrl: './move-project-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MoveProjectDialogComponent implements OnInit {
  protected form!: FormGroup;
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly fb = inject(FormBuilder);
  private readonly formValidationService = inject(FormValidationService);

  ngOnInit() {
    const data = this.config.data as MoveProjectDialogData;

    this.form = this.fb.group({
      targetCatalogId: [data.currentCatalogId, Validators.required]
    });
  }

  save() {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    const formValue = this.form.get('targetCatalogId')?.value;
    this.ref.close(formValue);
  }

  close() {
    this.ref.close();
  }
}
