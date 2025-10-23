import {SubtitleLookupService} from '../../../../model/settings.types';
import {AbstractControl, ValidationErrors, ValidatorFn} from '@angular/forms';

export interface EditLookupServiceDialogTypes {
  subtitleLookupService: Partial<SubtitleLookupService>;
}

export function urlTemplateValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string;
    if (!value) {
      return null; // Don't validate empty values, let 'required' handle it
    }

    const hasPlaceholder = value.includes('%%SS');
    if (!hasPlaceholder) {
      return {missingPlaceholder: true};
    }

    try {
      // Use a dummy replacement to check if the resulting URL is valid
      new URL(value.replace('%%SS', 'test'));
    } catch (e) {
      return {invalidUrl: true};
    }

    return null;
  };
}
