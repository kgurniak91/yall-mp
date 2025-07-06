import {Component, inject} from '@angular/core';
import {Button} from 'primeng/button';
import {FormsModule} from '@angular/forms';
import {Textarea} from 'primeng/textarea';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';

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
export class EditSubtitlesDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  protected readonly config = inject(DynamicDialogConfig);
  protected text: string = this.config.data.text;

  protected close(): void {
    this.ref.close();
  }

  protected save(): void {
    this.ref.close(this.text);
  }
}
