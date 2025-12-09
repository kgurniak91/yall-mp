import {AbstractControl, FormGroup, ValidationErrors, ValidatorFn} from '@angular/forms';
import {AnkiFieldMappingSource} from '../../../../model/anki.types';

export const ankiMappingValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const group = control as FormGroup;
  if (!group || !group.value) {
    return null;
  }

  const mappings = group.value;
  const isIdMapped = !!mappings.id;

  // Check if at least one other field (non-ID) has a value
  const isAnyOtherFieldMapped = Object.entries(mappings)
    .some(([key, value]) => key !== 'id' && !!value);

  // The form is valid if the ID is mapped AND at least one other field is mapped.
  if (isIdMapped && isAnyOtherFieldMapped) {
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
    description: 'All notes added to this clip either via the lookup in the built-in browser or manually.',
    required: false
  },
];

interface AppAnkiFieldSource {
  key: AnkiFieldMappingSource;
  label: string;
  description: string;
  required: boolean;
}
