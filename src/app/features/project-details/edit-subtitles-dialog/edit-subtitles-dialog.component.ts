import {Component, inject, OnInit} from '@angular/core';
import {Button} from 'primeng/button';
import {FormsModule} from '@angular/forms';
import {Textarea} from 'primeng/textarea';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {AssSubtitleData, SrtSubtitleData, SubtitleData, SubtitlePart} from '../../../../../shared/types/subtitle.type';
import {cloneDeep, isEqual} from 'lodash-es';
import {Divider} from 'primeng/divider';

@Component({
  selector: 'app-edit-subtitle-dialog',
  imports: [
    Button,
    FormsModule,
    Textarea,
    Divider
  ],
  templateUrl: './edit-subtitles-dialog.component.html',
  styleUrl: './edit-subtitles-dialog.component.scss'
})
export class EditSubtitlesDialogComponent implements OnInit {
  protected readonly config = inject(DynamicDialogConfig);
  protected readonly data: SubtitleData = this.config.data;
  protected text: string = ''; // for .srt
  protected editableParts: SubtitlePart[] = []; // for .ass
  private readonly ref = inject(DynamicDialogRef);

  ngOnInit(): void {
    if (this.data.type === 'srt') {
      this.text = this.data.text;
    } else { // .ass
      this.editableParts = cloneDeep(this.data.parts);
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

      // Reconstruct the clean text for each part before comparison and closing
      const finalParts = this.editableParts.map(p => ({
        ...p,
        text: p.fragments?.filter(f => !f.isTag).map(f => f.text).join('') ?? p.text
      }));

      if (!isEqual(finalParts, original.parts)) {
        this.ref.close({parts: finalParts});
      } else {
        this.ref.close();
      }
    }
  }
}
