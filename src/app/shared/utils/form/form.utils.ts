import {AbstractControl, FormArray, FormControl, FormGroup} from '@angular/forms';

export class FormUtils {
  static markAllAsDirty(control: AbstractControl): void {
    if (control instanceof FormControl) {
      control.markAsDirty({onlySelf: true});
    } else if (control instanceof FormGroup) {
      Object.keys(control.controls).forEach((key: string) => {
        FormUtils.markAllAsDirty(control.controls[key]);
      });
    } else if (control instanceof FormArray) {
      control.controls.forEach((childControl: AbstractControl) => FormUtils.markAllAsDirty(childControl));
    }
  }
}
