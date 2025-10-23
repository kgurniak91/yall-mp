import {Component, input} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {Tag} from 'primeng/tag';

@Component({
  selector: 'app-form-control-error',
  imports: [
    Tag
  ],
  templateUrl: './form-control-error.component.html',
  styleUrl: './form-control-error.component.scss'
})
export class FormControlErrorComponent {
  public readonly control = input.required<AbstractControl | null>();
}
