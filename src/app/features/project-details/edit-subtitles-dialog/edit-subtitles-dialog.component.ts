import {Component, inject, OnInit} from '@angular/core';
import {Button} from 'primeng/button';
import {FormsModule} from '@angular/forms';
import {Textarea} from 'primeng/textarea';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {AssSubtitleData, SrtSubtitleData, SubtitleData} from '../../../../../shared/types/subtitle.type';
import {isEqual} from 'lodash-es';
import {EditableSubtitlePart} from './edit-subtitles-dialog.type';

@Component({
  selector: 'app-edit-subtitle-dialog',
  imports: [
    Button,
    FormsModule,
    Textarea
  ],
  templateUrl: './edit-subtitles-dialog.component.html',
  styleUrl: './edit-subtitles-dialog.component.scss'
})
export class EditSubtitlesDialogComponent implements OnInit {
  protected readonly config = inject(DynamicDialogConfig);
  protected readonly data: SubtitleData = this.config.data;
  protected text: string = ''; // for .srt
  protected editableParts: EditableSubtitlePart[] = []; // for .ass
  private readonly ref = inject(DynamicDialogRef);

  ngOnInit(): void {
    if (this.data.type === 'srt') {
      this.text = this.data.text;
    } else { // .ass
      this.editableParts = this.data.parts.map(p => ({...p}));
    }
  }

  protected close(): void {
    this.ref.close();
  }

  protected save(): void {
    if (this.data.type === 'srt') {
      const original = this.data as SrtSubtitleData;
      if (this.text !== original.text) {
        this.ref.close({text: this.text});
      } else {
        this.ref.close();
      }
    } else { // .ass
      const original = this.data as AssSubtitleData;
      if (!isEqual(this.editableParts, original.parts)) {
        this.ref.close({parts: this.editableParts});
      } else {
        this.ref.close();
      }
    }
  }
}
