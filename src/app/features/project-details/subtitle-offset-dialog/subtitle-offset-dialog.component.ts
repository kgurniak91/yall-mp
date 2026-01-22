import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {InputNumber} from 'primeng/inputnumber';
import {FormsModule} from '@angular/forms';
import {Message} from 'primeng/message';
import {DecimalPipe, I18nPluralPipe} from '@angular/common';
import {SubtitleOffsetDialogData} from './subtitle-offset-dialog.types';

@Component({
  selector: 'app-subtitle-offset-dialog',
  imports: [
    Button,
    InputNumber,
    FormsModule,
    Message,
    DecimalPipe,
    I18nPluralPipe
  ],
  templateUrl: './subtitle-offset-dialog.component.html',
  styleUrl: './subtitle-offset-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SubtitleOffsetDialogComponent {
  protected readonly offsetMs = signal<number | null>(null);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly data: SubtitleOffsetDialogData;

  constructor() {
    this.data = this.config.data as SubtitleOffsetDialogData;
  }

  protected readonly offsetSeconds = computed(() => {
    const ms = this.offsetMs();
    return ms !== null ? (ms / 1000) : 0;
  });

  protected readonly validation = computed(() => {
    const seconds = this.offsetSeconds();
    if (seconds === 0) {
      return null;
    }

    return this.data.validate(seconds);
  });

  protected onApply() {
    const seconds = this.offsetSeconds();
    if (seconds !== 0) {
      this.data.apply(seconds);
      this.ref.close();
    }
  }

  protected onClose() {
    this.ref.close();
  }
}
