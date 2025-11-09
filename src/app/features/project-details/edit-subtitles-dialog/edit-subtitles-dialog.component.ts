import {Component, inject, OnInit} from '@angular/core';
import {Button} from 'primeng/button';
import {FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {Textarea} from 'primeng/textarea';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {
  AssSubtitleData,
  DialogSubtitlePart,
  SrtSubtitleData,
  SubtitleData,
  SubtitleFragment,
  SubtitlePart
} from '../../../../../shared/types/subtitle.type';
import {isEqual} from 'lodash-es';
import {Divider} from 'primeng/divider';
import {FormControlErrorComponent} from '../../../shared/components/form-control-error/form-control-error.component';
import {CustomValidators} from '../../../shared/validators/validators';
import {FormValidationService} from '../../../core/services/form-validation/form-validation.service';

interface EditedPartFormValue {
  originalIndex: number;
  style: string;
  text: string;
  fragments: SubtitleFragment[];
  track: number;
}

@Component({
  selector: 'app-edit-subtitle-dialog',
  imports: [
    Button,
    ReactiveFormsModule,
    Textarea,
    Divider,
    FormControlErrorComponent
  ],
  templateUrl: './edit-subtitles-dialog.component.html',
  styleUrl: './edit-subtitles-dialog.component.scss'
})
export class EditSubtitlesDialogComponent implements OnInit {
  protected readonly config = inject(DynamicDialogConfig);
  protected readonly data: SubtitleData = this.config.data;
  protected form!: FormGroup;
  private readonly ref = inject(DynamicDialogRef);
  private readonly fb = inject(FormBuilder);
  private readonly formValidationService = inject(FormValidationService);

  ngOnInit(): void {
    if (this.data.type === 'srt') {
      this.form = this.fb.group({
        text: [this.data.text, [Validators.required, CustomValidators.notBlank(), Validators.maxLength(1000)]]
      });
    } else { // .ass
      // Map parts to include their original index BEFORE sorting
      const partsWithOriginalIndex = this.data.parts.map((part, index) => ({
        part,
        originalIndex: index
      }));

      // Sort by track DESCENDING first, then by vertical position ASCENDING.
      partsWithOriginalIndex.sort((a, b) => {
        const aPart = a.part as DialogSubtitlePart;
        const bPart = b.part as DialogSubtitlePart;

        // Primary sort: by track number, DESCENDING
        if (aPart.track !== bPart.track) {
          return bPart.track - aPart.track;
        }

        // Secondary sort: by y-coordinate, ASCENDING (lower `y` means it's higher on the screen)
        return (aPart.y ?? Infinity) - (bPart.y ?? Infinity);
      });

      const visibleParts = partsWithOriginalIndex
        .filter(item => item.part.fragments?.some(f => !f.isTag));

      this.form = this.fb.group({
        parts: this.fb.array(
          visibleParts.map(item => this.createPartGroup(item.part as DialogSubtitlePart, item.originalIndex)),
          {validators: [CustomValidators.atLeastOneNotBlank()]}
        )
      });
    }
  }

  get partsFormArray(): FormArray {
    return this.form.get('parts') as FormArray;
  }

  getFragmentsArray(partIndex: number): FormArray {
    return this.partsFormArray.at(partIndex).get('fragments') as FormArray;
  }

  protected close(): void {
    this.ref.close();
  }

  protected save(): void {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }

    if (this.data.type === 'srt') {
      if (this.form.value.text !== (this.data as SrtSubtitleData).text) {
        this.ref.close({text: this.form.value.text});
      } else {
        this.ref.close();
      }
    } else { // .ass
      const originalParts = (this.data as AssSubtitleData).parts;
      const formValue = this.form.getRawValue();

      // Create a strongly typed map of edited parts from the form for easy lookup
      const editedPartsMap = new Map<number, EditedPartFormValue>(
        formValue.parts.map((p: EditedPartFormValue) => [p.originalIndex, p])
      );

      // Reconstruct the full parts array by merging edits into the original structure
      const finalParts: SubtitlePart[] = originalParts.map((originalPart, index) => {
        const editedPart = editedPartsMap.get(index);

        if (editedPart) {
          const reconstructedText = (editedPart.fragments || [])
            .filter((f) => !f.isTag)
            .map((f) => f.text)
            .join('');

          return {
            ...originalPart,
            style: editedPart.style,
            text: reconstructedText,
            fragments: editedPart.fragments
          };
        }

        return originalPart;
      });

      if (!isEqual(finalParts, originalParts)) {
        this.ref.close({parts: finalParts});
      } else {
        this.ref.close();
      }
    }
  }

  private createPartGroup(part: DialogSubtitlePart, originalIndex: number): FormGroup {
    return this.fb.group({
      originalIndex: [originalIndex],
      style: [part.style],
      text: [part.text, [Validators.maxLength(1000)]],
      track: [part.track],
      fragments: this.fb.array(
        (part.fragments || []).map(fragment => this.fb.group({
          text: [fragment.text, !fragment.isTag ? [Validators.maxLength(1000)] : []],
          isTag: [fragment.isTag]
        }))
      )
    });
  }
}
