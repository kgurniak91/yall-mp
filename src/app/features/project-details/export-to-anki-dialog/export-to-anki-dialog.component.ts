import {Component, computed, inject, signal} from '@angular/core';
import {AnkiCard, AnkiCardTemplate} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {SubtitleData} from '../../../../../shared/types/subtitle.type';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';

@Component({
  selector: 'app-export-to-anki-dialog',
  imports: [
    Select,
    FormsModule,
    Button
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss'
})
export class ExportToAnkiDialogComponent {
  private readonly ankiService = inject(AnkiStateService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly toastService = inject(ToastService);
  protected readonly subtitleClip: SubtitleData = this.config.data.subtitleClip;
  protected readonly validTemplates = computed(() =>
    this.ankiService.ankiCardTemplates().filter(t => t.isValid)
  );
  protected selectedTemplate = signal<AnkiCardTemplate | null>(null);
  protected isExporting = signal(false);

  onCancel(): void {
    this.ref.close();
  }

  async onExport(): Promise<void> {
    const template = this.selectedTemplate();
    if (!template || !template.ankiDeck || !template.ankiNoteType) return;

    this.isExporting.set(true);

    const fields: Record<string, string> = {};
    for (const mapping of template.fieldMappings) {
      if (mapping.source === 'text') {
        fields[mapping.destination] = this.subtitleClip.text;
      }
      // TODO 'audio', 'screenshot', etc.
    }

    const card: AnkiCard = {
      deckName: template.ankiDeck,
      modelName: template.ankiNoteType,
      fields: fields,
      tags: ['yall-mp'] // TODO custom tags
    };

    try {
      const cardId = await window.electronAPI.createAnkiCard(card);
      if (cardId) {
        this.toastService.success('Successfully created Anki card');
        this.ref.close(true);
      } else {
        this.toastService.error('Failed to create Anki card. Is Anki open?');
      }
    } catch (e) {
      this.toastService.error('An error occurred during export.');
      console.error(e);
    } finally {
      this.isExporting.set(false);
    }
  }
}
