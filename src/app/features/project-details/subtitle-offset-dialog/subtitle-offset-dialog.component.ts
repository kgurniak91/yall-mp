import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {InputNumber} from 'primeng/inputnumber';
import {FormsModule} from '@angular/forms';
import {Message} from 'primeng/message';
import {I18nPluralPipe} from '@angular/common';
import {SubtitleOffsetDialogData} from './subtitle-offset-dialog.types';
import {TabsModule} from 'primeng/tabs';
import {SelectModule} from 'primeng/select';

@Component({
  selector: 'app-subtitle-offset-dialog',
  imports: [
    Button,
    InputNumber,
    FormsModule,
    Message,
    I18nPluralPipe,
    TabsModule,
    SelectModule
  ],
  templateUrl: './subtitle-offset-dialog.component.html',
  styleUrl: './subtitle-offset-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SubtitleOffsetDialogComponent {
  protected readonly offsetMs = signal<number | null>(null);
  protected readonly ratio = signal<number>(1.0);
  protected readonly selectedFpsPreset = signal<any>(null);

  protected readonly fpsPresets = [
    {label: 'None / Reset', value: 1.0},
    {label: 'Film to PAL (23.976 fps → 25 fps)', value: 23.976 / 25},
    {label: 'PAL to Film (25 fps → 23.976 fps)', value: 25 / 23.976},
    {label: 'Film to HD (23.976 fps → 24 fps)', value: 23.976 / 24},
    {label: 'NTSC to PAL (29.97 fps → 25 fps)', value: 29.97 / 25}
  ];

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
    return this.data.validate(this.offsetSeconds(), this.ratio());
  });

  protected isUnchanged = computed(() => {
    return this.offsetSeconds() === 0 && this.ratio() === 1;
  });

  protected onPresetChange(preset: any) {
    if (preset) {
      this.ratio.set(preset.value);
      if (preset.value === 1.0) {
        this.offsetMs.set(null);
      }
    }
  }

  protected onApply() {
    this.data.apply(this.offsetSeconds(), this.ratio());
    this.ref.close();
  }

  protected onClose() {
    this.ref.close();
  }
}
