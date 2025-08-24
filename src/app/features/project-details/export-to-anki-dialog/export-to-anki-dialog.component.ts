import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiExportRequest, ExportToAnkiDialogData} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {AssSubtitleData, SubtitleData, SubtitlePart} from '../../../../../shared/types/subtitle.type';
import {Checkbox} from 'primeng/checkbox';

@Component({
  selector: 'app-export-to-anki-dialog',
  imports: [
    Select,
    FormsModule,
    Button,
    Checkbox
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss'
})
export class ExportToAnkiDialogComponent implements OnInit {
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
  protected assSubtitleData: AssSubtitleData | null = null;
  protected selectedSubtitleParts = signal<SubtitlePart[]>([]);
  protected readonly finalTextPreview = computed(() => {
    if (this.data.subtitleData.type === 'srt') {
      return this.data.subtitleData.text;
    } else {
      return this.selectedSubtitleParts().map(p => p.text).join('\n');
    }
  });

  constructor() {
    this.data = this.config.data as ExportToAnkiDialogData;
  }

  ngOnInit() {
    if (this.data.subtitleData.type === 'ass') {
      this.assSubtitleData = this.data.subtitleData;
      // Pre-select all parts by default for convenience
      this.selectedSubtitleParts.set([...this.assSubtitleData.parts]);
    }
  }

  onCancel(): void {
    this.ref.close();
  }

  async onExport(): Promise<void> {
    const template = this.selectedTemplate();
    if (!template || !template.ankiDeck || !template.ankiNoteType) {
      return;
    }

    if (!this.finalTextPreview().trim()) {
      this.toastService.warn('Please select at least one subtitle part to export.');
      return;
    }

    const {project, exportTime} = this.data;
    let subtitleForExport: SubtitleData;

    if (this.data.subtitleData.type === 'srt') {
      subtitleForExport = {
        ...this.data.subtitleData,
        text: this.finalTextPreview()
      };
    } else { // 'ass'
      subtitleForExport = {
        ...this.data.subtitleData,
        parts: this.selectedSubtitleParts()
      };
    }

    this.isExporting.set(true);

    const request: AnkiExportRequest = {
      template: template,
      subtitleData: subtitleForExport,
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
