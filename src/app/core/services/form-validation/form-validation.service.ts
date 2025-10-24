import {inject, Injectable} from '@angular/core';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {FormGroup} from '@angular/forms';
import {FormUtils} from '../../../shared/utils/form/form.utils';

@Injectable({
  providedIn: 'root'
})
export class FormValidationService {
  private readonly toastService = inject(ToastService);

  public isFormValid(formGroup: FormGroup): boolean {
    if (formGroup.invalid) {
      FormUtils.markAllAsDirty(formGroup);
      this.toastService.warn('Please correct the form errors before saving');
      return false;
    }

    return true;
  }
}
