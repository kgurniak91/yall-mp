import {Component, computed, inject, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiExportRequest, ExportToAnkiDialogData} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
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
  protected readonly data: ExportToAnkiDialogData;
  protected readonly validTemplates = computed(() =>
    this.ankiService.ankiCardTemplates().filter(t => t.isValid)
  );
  protected selectedTemplate = signal<AnkiCardTemplate | null>(null);
  protected isExporting = signal(false);

  constructor() {
    this.data = this.config.data as ExportToAnkiDialogData;
  }

  onCancel(): void {
    this.ref.close();
  }

  async onExport(): Promise<void> {
    const template = this.selectedTemplate();
    if (!template || !template.ankiDeck || !template.ankiNoteType) {
      return;
    }

    const {project, subtitleData, exportTime} = this.data;

    this.isExporting.set(true);

    const request: AnkiExportRequest = {
      template: template,
      subtitleData: subtitleData,
      mediaPath: project.mediaPath,
      exportTime
    };

    try {
      const result = await window.electronAPI.exportAnkiCard(request);
      if (result.cardId) {
        this.toastService.success('Successfully created Anki card');
        this.ref.close(true);
      } else {
        this.toastService.error(result.error || 'Failed to create Anki card. Is Anki open?');
      }
    } catch (e: any) {
      this.toastService.error(e.message || 'An error occurred during export.');
      console.error(e);
    } finally {
      this.isExporting.set(false);
    }
  }
}
