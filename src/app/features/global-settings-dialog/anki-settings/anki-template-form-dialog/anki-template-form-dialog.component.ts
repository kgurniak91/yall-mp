import {Component, inject, OnInit} from '@angular/core';
import {FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {AnkiCardTemplate, AnkiFieldMapping, AnkiFieldMappingSource} from '../../../../model/anki.types';
import {AnkiStateService} from '../../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {InputText} from 'primeng/inputtext';
import {Select} from 'primeng/select';
import {Fieldset} from 'primeng/fieldset';
import {ToastService} from '../../../../shared/services/toast/toast.service';
import {Divider} from 'primeng/divider';
import {ankiMappingValidator, APP_ANKI_FIELDS} from './anki-template-form-dialog.types';
import {Message} from 'primeng/message';
import {TagsInputComponent} from '../../../../shared/components/tags-input/tags-input.component';

@Component({
  selector: 'app-anki-template-form-dialog',
  imports: [
    ReactiveFormsModule,
    Button,
    InputText,
    Select,
    Fieldset,
    Divider,
    Message,
    TagsInputComponent
  ],
  templateUrl: './anki-template-form-dialog.component.html',
  styleUrl: './anki-template-form-dialog.component.scss'
})
export class AnkiTemplateFormDialogComponent implements OnInit {
  protected readonly form: FormGroup;
  protected readonly appAnkiFields = APP_ANKI_FIELDS;
  protected readonly ankiStateService = inject(AnkiStateService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly fb = inject(FormBuilder);
  private readonly toastService = inject(ToastService);
  private allAnkiFieldsForNoteType: string[] = [];

  constructor() {
    this.form = this.initForm();
  }

  ngOnInit(): void {
    const template = this.dialogConfig.data?.template as AnkiCardTemplate | undefined;
    const noteTypeControl = this.form.get('ankiNoteType')!;

    if (template?.ankiNoteType) {
      this.ankiStateService.fetchNoteTypeFields(template.ankiNoteType).then(fields => {
        this.allAnkiFieldsForNoteType = fields;
      });
    }

    noteTypeControl.valueChanges.subscribe(async (noteType) => {
      const mappingsGroup = this.form.get('fieldMappings') as FormGroup;
      mappingsGroup.reset(); // Clear old mappings when note type changes
      if (noteType) {
        this.allAnkiFieldsForNoteType = await this.ankiStateService.fetchNoteTypeFields(noteType);
      } else {
        this.allAnkiFieldsForNoteType = [];
      }
    });
  }

  protected getAvailableAnkiFields(currentSourceKey: AnkiFieldMappingSource): string[] {
    const allFields = this.allAnkiFieldsForNoteType;
    const mappingsGroup = this.form.get('fieldMappings') as FormGroup;

    // Get a list of all values selected in OTHER dropdowns.
    const otherSelectedFields = Object.keys(mappingsGroup.controls)
      .filter(key => key !== currentSourceKey) // Exclude the current dropdown
      .map(key => mappingsGroup.get(key)?.value) // Get their values
      .filter(Boolean); // Filter out null/undefined values

    // An Anki field is available if it's not currently selected by another source.
    return allFields.filter(field => !otherSelectedFields.includes(field));
  }

  protected onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.warn('Please fill out all required fields.');
      return;
    }
    const rawValue = this.form.getRawValue();
    const mappingsObject = rawValue.fieldMappings;

    const mappingsArray: AnkiFieldMapping[] = Object.entries(mappingsObject)
      .filter(([_, destination]) => destination) // Filter out unmapped sources
      .map(([source, destination]) => ({
        source: source as AnkiFieldMappingSource,
        destination: destination as string
      }));

    const finalTemplate: AnkiCardTemplate = {
      ...rawValue,
      fieldMappings: mappingsArray
    };

    this.dialogRef.close(finalTemplate);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  private initForm(): FormGroup {
    const template: AnkiCardTemplate | undefined = this.dialogConfig.data?.template;

    const mappingControls: { [key in AnkiFieldMappingSource]?: FormControl } = {};
    for (const source of this.appAnkiFields) {
      const existingMapping = template?.fieldMappings.find(m => m.source === source.key);
      mappingControls[source.key] = this.fb.control(existingMapping?.destination || null);
    }

    return this.fb.group({
      id: [template?.id || ''],
      name: [template?.name || '', Validators.required],
      ankiDeck: [template?.ankiDeck || null, Validators.required],
      ankiNoteType: [template?.ankiNoteType || null, Validators.required],
      tags: [template?.tags || []],
      fieldMappings: this.fb.group(mappingControls, {validators: ankiMappingValidator})
    });
  }
}
