import {ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {Tag} from 'primeng/tag';
import {merge} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-form-control-error',
  imports: [
    Tag
  ],
  templateUrl: './form-control-error.component.html',
  styleUrl: './form-control-error.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FormControlErrorComponent {
  public readonly control = input.required<AbstractControl | null>();
  protected readonly errorMessages = signal<string[]>([]);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect((onCleanup) => {
      const control = this.control();
      if (!control) {
        this.errorMessages.set([]);
        return;
      }

      const changes$ = merge(
        control.statusChanges,
        control.valueChanges,
        control.events
      );

      const sub = changes$.pipe(
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(() => {
        this.updateErrors(control);
      });

      this.updateErrors(control);

      onCleanup(() => sub.unsubscribe());
    });
  }

  private updateErrors(control: AbstractControl): void {
    if (control.invalid && control.dirty) {
      const messages = this.getErrorMessages(control);
      this.errorMessages.set(messages);
    } else {
      this.errorMessages.set([]);
    }
  }

  private getErrorMessages(control: AbstractControl): string[] {
    const errors: string[] = [];
    if (!control.errors) {
      return errors;
    }

    Object.keys(control.errors).forEach(key => {
      switch (key) {
        case 'required':
          errors.push('This field is required');
          break;
        case 'notBlank':
          errors.push('This field cannot be blank');
          break;
        case 'maxlength':
          const requiredLength = control.errors?.[key]?.requiredLength;
          errors.push(`Exceeds maximum length of ${requiredLength}`);
          break;
        case 'invalidUrl':
          errors.push('Please enter a valid URL format');
          break;
        case 'missingPlaceholder':
          errors.push('URL must contain the %%SS placeholder');
          break;
        case 'atLeastOneNotBlank':
          errors.push('At least one subtitle part must contain text');
          break;
        case 'nameTaken':
          errors.push('Name is already taken');
          break;
        default:
          errors.push('Invalid value');
          break;
      }
    });

    return errors;
  }
}
