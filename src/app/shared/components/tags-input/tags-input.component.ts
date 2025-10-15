import {Component, forwardRef, inject} from '@angular/core';
import {ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR} from '@angular/forms';
import {Button} from 'primeng/button';
import {InputText} from 'primeng/inputtext';
import {ToastService} from '../../services/toast/toast.service';
import {Chip} from 'primeng/chip';

@Component({
  selector: 'app-tags-input',
  standalone: true,
  imports: [
    FormsModule,
    Button,
    InputText,
    Chip
  ],
  templateUrl: './tags-input.component.html',
  styleUrl: './tags-input.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TagsInputComponent),
      multi: true
    }
  ]
})
export class TagsInputComponent implements ControlValueAccessor {
  protected tags: string[] = [];
  protected newTag = '';
  protected disabled = false;
  private readonly toastService = inject(ToastService);

  private onChange: (value: string[]) => void = () => {
  };

  private onTouched: () => void = () => {
  };

  // Allow words, optionally separated by '::' for hierarchical tags
  private readonly ankiTagRegex = /^[a-zA-Z0-9\-_]+(::[a-zA-Z0-9\-_]+)*$/;

  writeValue(value: string[]): void {
    this.tags = Array.isArray(value) ? [...value] : [];
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  protected addTag(): void {
    // Sanitize the input: trim whitespace and auto-replace spaces with hyphens
    const tag = this.newTag.trim().replace(/\s+/g, '-');
    if (!tag) {
      return;
    }

    // Validate against allowed characters
    if (!this.ankiTagRegex.test(tag)) {
      this.toastService.warn('Invalid tag format. Tags can\'t contain spaces or special characters, and hierarchy must use double colons (e.g., "parent::child")');
      return;
    }

    // Prevent duplicates
    if (this.tags.includes(tag)) {
      this.toastService.info('This tag has already been added.');
      this.newTag = '';
      return;
    }

    this.tags.push(tag);
    this.onChange(this.tags);
    this.onTouched();
    this.newTag = '';
  }

  protected removeTag(tagToRemove: string): void {
    this.tags = this.tags.filter(tag => tag !== tagToRemove);
    this.onChange(this.tags);
    this.onTouched();
  }
}
