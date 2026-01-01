import {AbstractControl, FormGroup, ValidationErrors, ValidatorFn} from '@angular/forms';
import {AnkiFieldMappingSource} from '../../../../model/anki.types';

const CONTENT_FIELDS: AnkiFieldMappingSource[] = ['text', 'audio', 'screenshot', 'video', 'animation'];

export const ankiMappingValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const group = control as FormGroup;
  if (!group || !group.value) {
    return null;
  }

  const mappings = group.value;
  const isIdMapped = !!mappings.id;

  // Check if at least one content field is mapped (`notes` and `hint` fields are totally optional)
  const isContentMapped = CONTENT_FIELDS.some(field => !!mappings[field]);

  // The form is valid if the ID is mapped AND at least one content field is mapped.
  if (isIdMapped && isContentMapped) {
    return null; // Valid
  }

  return {ankiMappingInvalid: true}; // Invalid
};

export const APP_ANKI_FIELDS: AppAnkiFieldSource[] = [
  {
    key: 'id',
    label: 'ID',
    description: 'A unique identifier for each card.',
    required: true
  },
  {
    key: 'text',
    label: 'Subtitle Text',
    description: 'The main text content from the subtitle clip.',
    required: false
  },
  {
    key: 'audio',
    label: 'Audio',
    description: 'The audio extracted from the media for the clip\'s duration.',
    required: false
  },
  {
    key: 'screenshot',
    label: 'Screenshot',
    description: 'A single video frame captured at the moment of export.',
    required: false
  },
  {
    key: 'video',
    label: 'Video Clip',
    description: 'A short video clip of the subtitle\'s duration.',
    required: false
  },
  {
    key: 'animation',
    label: 'Animation',
    description: 'A silent, looping animation (AVIF format).',
    required: false
  },
  {
    key: 'notes',
    label: 'Notes',
    description: 'All notes added to this clip either manually or via the lookup (in the built-in browser or offline dictionary popup).',
    required: false
  },
  {
    key: 'hint',
    label: 'Hint',
    description: 'Optional context to provide for the sentence, to avoid ambiguity when it can have many meanings.',
    required: false
  },
];

interface AppAnkiFieldSource {
  key: AnkiFieldMappingSource;
  label: string;
  description: string;
  required: boolean;
}
