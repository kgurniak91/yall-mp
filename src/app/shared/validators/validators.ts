import {AbstractControl, FormArray, ValidationErrors, ValidatorFn} from '@angular/forms';

export class CustomValidators {
  static notBlank(): ValidatorFn {
    return (control: AbstractControl<string>): ValidationErrors | null => {
      const value = control.value;

      if (value?.length && /^\s*$/.test(value)) {
        return {'notBlank': true};
      }

      return null;
    };
  }

  static atLeastOneNotBlank(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!(control instanceof FormArray)) {
        return null;
      }

      const formArray = control as FormArray;

      const hasAtLeastOneText = formArray.controls.some(partGroup => {
        // Check if this part has fragments
        const fragmentsArray = partGroup.get('fragments') as FormArray | null;

        if (fragmentsArray && fragmentsArray.length > 0) {
          // If it has fragments, check if ANY non-tag fragment has text
          return fragmentsArray.controls.some(fragmentGroup => {
            const isTag = fragmentGroup.get('isTag')?.value === true;
            const text = fragmentGroup.get('text')?.value;
            return !isTag && text && text.trim().length > 0;
          });
        }

        // Fallback: If no fragments, just check the main text field of the part
        const text = partGroup.get('text')?.value;
        return text && text.trim().length > 0;
      });

      return hasAtLeastOneText ? null : {'atLeastOneNotBlank': true};
    };
  }
}
