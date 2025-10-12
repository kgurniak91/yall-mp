import {Component, computed, inject, OnDestroy, OnInit, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiExportRequest, ExportToAnkiDialogData} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {AssSubtitleData, SubtitleData, SubtitlePart} from '../../../../../shared/types/subtitle.type';
import {Checkbox} from 'primeng/checkbox';
import {Textarea} from 'primeng/textarea';
import {ClipNotes} from '../../../model/project.types';
import {cloneDeep, isEqual} from 'lodash-es';
import {AppStateService} from '../../../state/app/app-state.service';
import {Popover} from 'primeng/popover';

const SAVE_DEBOUNCE_TIME_MS = 500;

interface NoteViewItem {
  text: string;
  originalIndex: number;
}

interface SelectionGroupView {
  selection: string;
  notes: NoteViewItem[];
}

@Component({
  selector: 'app-export-to-anki-dialog',
  imports: [
    Select,
    FormsModule,
    Button,
    Checkbox,
    Textarea,
    Popover
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss'
})
export class ExportToAnkiDialogComponent implements OnInit, OnDestroy {
  protected readonly data: ExportToAnkiDialogData;
  protected readonly validTemplates = computed(() =>
    this.ankiService.ankiCardTemplates().filter(t => t.isValid)
  );
  protected readonly selectedTemplate = signal<AnkiCardTemplate | null>(null);
  protected readonly isExporting = signal(false);
  protected readonly selectedSubtitleParts = signal<SubtitlePart[]>([]);
  protected readonly finalTextPreview = computed(() => {
    if (this.data.subtitleData.type === 'srt') {
      return this.data.subtitleData.text;
    } else {
      return this.selectedSubtitleParts().map(p => p.text).join('\n');
    }
  });
  protected readonly notesView = signal<SelectionGroupView[]>([]);
  protected readonly finalAnkiNotes = computed(() => {
    let formattedString = '';
    for (const group of this.notesView()) {
      formattedString += `* "${group.selection}"\n`;
      for (const note of group.notes) {
        formattedString += `  - ${note.text.trim()}\n`;
      }
    }
    return formattedString.trim();
  });
  protected assSubtitleData: AssSubtitleData | null = null;
  private readonly ankiService = inject(AnkiStateService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly toastService = inject(ToastService);
  private readonly appStateService = inject(AppStateService);
  private initialNotes: ClipNotes | undefined;
  private debounceTimeout: any;

  constructor() {
    this.data = this.config.data as ExportToAnkiDialogData;
  }

  ngOnInit() {
    if (this.data.subtitleData.type === 'ass') {
      this.assSubtitleData = this.data.subtitleData;
      // Pre-select all parts by default for convenience
      this.selectedSubtitleParts.set([...this.assSubtitleData.parts]);
    }

    const clipNotes = this.data.project.notes?.[this.data.subtitleData.id];
    this.initialNotes = cloneDeep(clipNotes); // Store initial state for comparison when saving
    this.buildNotesView(clipNotes);
  }

  ngOnDestroy() {
    this.clearDebounceTimeout();
    this.saveNotesIfChanged();
  }

  onNoteChange(noteItem: NoteViewItem, event: Event): void {
    noteItem.text = (event.target as HTMLTextAreaElement).value;

    this.clearDebounceTimeout();
    this.debounceTimeout = setTimeout(() => {
      this.saveNotesIfChanged();
    }, SAVE_DEBOUNCE_TIME_MS);
  }

  onDeleteNote(selection: string, noteIndex: number): void {
    this.notesView.update(currentView => {
      return currentView.map(group => {
        if (group.selection === selection) {
          return {
            ...group,
            notes: group.notes.filter(note => note.originalIndex !== noteIndex)
          };
        }
        return group;
      }).filter(group => group.notes.length > 0); // Remove the entire group if it's now empty
    });
    this.saveNotesIfChanged();
    this.toastService.success('Note removed');
  }

  onClose(): void {
    this.ref.close();
  }

  async onExport(): Promise<void> {
    const template = this.selectedTemplate();
    if (!template || !template.ankiDeck || !template.ankiNoteType) {
      return;
    }

    this.clearDebounceTimeout();
    this.saveNotesIfChanged();

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
      exportTime,
      notes: this.finalAnkiNotes()
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

  private buildNotesView(clipNotes: ClipNotes | undefined): void {
    if (!clipNotes) {
      this.notesView.set([]);
      return;
    }

    const view: SelectionGroupView[] = Object.entries(clipNotes).map(([selection, noteList]) => ({
      selection,
      notes: noteList.map((text, index) => ({text, originalIndex: index}))
    }));

    this.notesView.set(view);
  }

  private saveNotesIfChanged(): void {
    const project = this.data.project;
    const clipId = this.data.subtitleData.id;

    const finalNotes: ClipNotes = {};
    for (const group of this.notesView()) {
      if (group.notes.length > 0) {
        // re-index the notes to get a clean, contiguous array
        finalNotes[group.selection] = group.notes
          .sort((a, b) => a.originalIndex - b.originalIndex)
          .map(note => note.text);
      }
    }

    if (!isEqual(this.initialNotes, finalNotes)) {
      const newProjectNotes = cloneDeep(project.notes ?? {});

      if (Object.keys(finalNotes).length > 0) {
        newProjectNotes[clipId] = finalNotes;
      } else {
        delete newProjectNotes[clipId];
      }

      this.appStateService.updateProject(project.id, {notes: newProjectNotes});

      // Update the baseline to the newly saved state for future comparisons
      this.initialNotes = cloneDeep(finalNotes);
    }
  }

  private clearDebounceTimeout(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
  }
}
