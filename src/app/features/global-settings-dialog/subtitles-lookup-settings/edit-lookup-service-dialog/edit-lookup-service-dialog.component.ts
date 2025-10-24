import {Component, computed, inject, OnInit} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {Button} from 'primeng/button';
import {InputText} from 'primeng/inputtext';
import {Select} from 'primeng/select';
import {SubtitleLookupBrowserType} from '../../../../model/settings.types';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {EditLookupServiceDialogTypes, urlTemplateValidator} from './edit-lookup-service-dialog.types';
import {FormControlErrorComponent} from "../../../../shared/components/form-control-error/form-control-error.component";
import {CustomValidators} from '../../../../shared/validators/validators';
import {FormValidationService} from '../../../../core/services/form-validation/form-validation.service';

@Component({
  selector: 'app-edit-lookup-service-dialog',
  imports: [ReactiveFormsModule, Button, InputText, Select, FormControlErrorComponent],
  templateUrl: './edit-lookup-service-dialog.component.html',
  styleUrl: './edit-lookup-service-dialog.component.scss'
})
export class EditLookupServiceDialogComponent implements OnInit {
  protected form!: FormGroup;
  protected browserTypeOptions = computed(() => {
    const globalDefault = this.globalSettingsStateService.subtitleLookupBrowserType();
    const defaultLabel = (globalDefault === SubtitleLookupBrowserType.System) ? 'System' : 'Built-in';

    return [
      {label: `Default (${defaultLabel})`, value: null},
      {label: 'Built-in Browser', value: SubtitleLookupBrowserType.BuiltIn},
      {label: 'System Browser', value: SubtitleLookupBrowserType.System}
    ];
  });
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly fb = inject(FormBuilder);
  private readonly formValidationService = inject(FormValidationService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  ngOnInit(): void {
    const data = this.config.data as EditLookupServiceDialogTypes;
    const service = data.subtitleLookupService;

    this.form = this.fb.group({
      id: [service.id],
      name: [service.name || '', [Validators.required, CustomValidators.notBlank(), Validators.maxLength(255)]],
      urlTemplate: [service.urlTemplate || '', [Validators.required, CustomValidators.notBlank(), urlTemplateValidator(), Validators.maxLength(255)]],
      browserType: [service.browserType || null],
      isDefault: [service.isDefault]
    });
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    this.ref.close(this.form.value);
  }
}
