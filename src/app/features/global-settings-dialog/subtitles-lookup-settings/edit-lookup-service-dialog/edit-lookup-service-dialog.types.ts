import {LookupType, SubtitleLookupService} from '../../../../model/settings.types';
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

    const group = control.parent;
    if (group) {
      const type: LookupType = group.get('type')?.value;
      if (type !== 'ai') {
        const hasPlaceholder = value.includes('%%SS');
        if (!hasPlaceholder) {
          return {missingPlaceholder: true};
        }
      }
    }

    try {
      let testValue = value.replace('%%SS', 'test');

      // For urls starting with "www", prepend protocol just for the validation check
      if (testValue.toLowerCase().startsWith('www.')) {
        testValue = 'https://' + testValue;
      }

      // Use a dummy replacement to check if the resulting URL is valid
      new URL(testValue);
    } catch (e) {
      return {invalidUrl: true};
    }

    return null;
  };
}
