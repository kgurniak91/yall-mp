import {Component, computed, inject, OnDestroy, OnInit, signal} from '@angular/core';
import {
  AnkiCardTemplate,
  AnkiConnectStatus,
  AnkiExportRequest,
  ExportToAnkiDialogData
} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {AssSubtitleData, SubtitleData, SubtitlePart} from '../../../../../shared/types/subtitle.type';
import {Checkbox} from 'primeng/checkbox';
import {Textarea} from 'primeng/textarea';
import {LookupNotes, ProjectClipNotes} from '../../../model/project.types';
import {cloneDeep, escape, isEqual} from 'lodash-es';
import {AppStateService} from '../../../state/app/app-state.service';
import {Popover} from 'primeng/popover';
import {DialogOrchestrationService} from '../../../core/services/dialog-orchestration/dialog-orchestration.service';
import {GlobalSettingsTab} from '../../global-settings-dialog/global-settings-dialog.types';
import {Divider} from 'primeng/divider';
import {Chip} from 'primeng/chip';
import {TagsInputComponent} from '../../../shared/components/tags-input/tags-input.component';
import {Tooltip} from 'primeng/tooltip';

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
    FormsModule,
    Button,
    Checkbox,
    Textarea,
    Popover,
    Divider,
    Chip,
    TagsInputComponent,
    Tooltip
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss'
})
export class ExportToAnkiDialogComponent implements OnInit, OnDestroy {
  protected readonly data: ExportToAnkiDialogData;
  protected readonly cardSpecificTags = signal<string[]>([]);
  protected readonly selectedTemplates = signal<AnkiCardTemplate[]>([]);
  protected readonly manualNote = signal<string>('');
  protected readonly isExporting = signal(false);
  protected readonly selectedSubtitleParts = signal<SubtitlePart[]>([]);
  protected readonly finalTextPreview = computed(() => {
    if (this.data.subtitleData.type === 'srt') {
      return this.data.subtitleData.text;
    } else {
      return this.selectedSubtitleParts().map(p => p.text).join('\n');
    }
  });
  protected readonly lookupNotesView = signal<SelectionGroupView[]>([]);
  protected readonly formattedAnkiNotes = computed(() => {
    const finalParts: string[] = [];

    // Process Lookup Notes
    for (const group of this.lookupNotesView()) {
      const escapedSelection = escape(group.selection);
      let groupHtml = `<b>"${escapedSelection}"</b>:<br><ul>`;
      for (const note of group.notes) {
        let formattedNote = escape(note.text).trim().replace(/\n/g, '<br>');
        if (!formattedNote) {
          formattedNote = '&nbsp;'; // Ensure empty notes are still visible in a list item
        }
        groupHtml += `<li>${formattedNote}<br></li>`;
      }
      groupHtml += '</ul>';
      finalParts.push(groupHtml);
    }

    // Process Manual Note
    const manualNoteText = this.manualNote().trim();
    if (manualNoteText) {
      let manualNoteHtml = '<b>Manual notes</b>:<br><ul>';
      let formattedManualNote = escape(manualNoteText).replace(/\n/g, '<br>');
      if (!formattedManualNote) {
        formattedManualNote = '&nbsp;';
      }
      manualNoteHtml += `<li>${formattedManualNote}<br></li>`;
      manualNoteHtml += '</ul>';
      finalParts.push(manualNoteHtml);
    }

    return finalParts.join('');
  });
  protected assSubtitleData: AssSubtitleData | null = null;
  protected readonly exportTags = signal<string[]>([]);
  protected readonly ankiService = inject(AnkiStateService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly toastService = inject(ToastService);
  private readonly appStateService = inject(AppStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private initialNotes: ProjectClipNotes | undefined;
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

    const project = this.data.project;
    const globalTags = this.ankiService.ankiGlobalTags();
    const projectTags = project.ankiTags || [];
    this.exportTags.set(Array.from(new Set([...globalTags, ...projectTags])));

    if (project.selectedAnkiTemplateIds) {
      const preselectedTemplates = this.ankiService.ankiCardTemplates().filter(t => project.selectedAnkiTemplateIds!.includes(t.id));
      this.selectedTemplates.set(preselectedTemplates);
    }

    const projectNotes = this.data.project.notes?.[this.data.subtitleData.id];
    this.initialNotes = cloneDeep(projectNotes); // Store initial state for comparison when saving
    this.manualNote.set(projectNotes?.manualNote || '');
    this.buildNotesView(projectNotes?.lookupNotes);
  }

  ngOnDestroy() {
    this.clearDebounceTimeout();
    this.saveNotesIfChanged();
    this.saveSelectedTemplates();
  }

  getGroupedTagsForTemplate(template: AnkiCardTemplate): { global: string[], project: string[], template: string[] } {
    const global = this.ankiService.ankiGlobalTags();
    const project = this.data.project.ankiTags || [];
    const templateTags = template.tags || [];

    return {
      global: [...new Set(global)],
      project: [...new Set(project)],
      template: [...new Set(templateTags)],
    };
  }

  onNoteChange(noteItem: NoteViewItem, event: Event): void {
    noteItem.text = (event.target as HTMLTextAreaElement).value;

    this.clearDebounceTimeout();
    this.debounceTimeout = setTimeout(() => {
      this.saveNotesIfChanged();
    }, SAVE_DEBOUNCE_TIME_MS);
  }

  onDeleteNote(selection: string, noteIndex: number): void {
    this.lookupNotesView.update(currentView => {
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

  openGlobalSettings(event: MouseEvent): void {
    event.preventDefault();
    this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.Anki);
  }

  async onExport(): Promise<void> {
    this.isExporting.set(true);

    await this.ankiService.checkAnkiConnection();

    if (this.ankiService.status() !== AnkiConnectStatus.connected) {
      this.toastService.error('Failed to connect. Is Anki open?');
      this.isExporting.set(false);
      return;
    }

    const templates = this.selectedTemplates();
    if (templates.length === 0) {
      this.toastService.warn('Please select at least one template to export.');
      this.isExporting.set(false);
      return;
    }

    this.clearDebounceTimeout();
    this.saveNotesIfChanged();

    if (!this.finalTextPreview().trim()) {
      this.toastService.warn('Please select at least one subtitle part to export.');
      this.isExporting.set(false);
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

    let successCount = 0;

    for (const template of templates) {
      if (!template.ankiDeck || !template.ankiNoteType) {
        this.toastService.warn(`Skipping template "${template.name}" as it is incomplete.`);
        continue;
      }

      const baseTags = this.exportTags();
      const templateTags = template.tags || [];
      const cardSpecificTags = this.cardSpecificTags() || [];
      const finalTags = Array.from(new Set([...baseTags, ...templateTags, ...cardSpecificTags]));

      const request: AnkiExportRequest = {
        template: template,
        subtitleData: subtitleForExport,
        mediaPath: project.mediaPath,
        exportTime,
        notes: this.formattedAnkiNotes(),
        tags: finalTags
      };

      try {
        const result = await window.electronAPI.exportAnkiCard(request);
        if (result.cardId) {
          this.toastService.success(`Successfully created Anki card for template "${template.name}"`);
          successCount++;
        } else {
          this.toastService.error(result.error || `Failed to create Anki card for template "${template.name}". Is Anki open?`);
        }
      } catch (e: any) {
        this.toastService.error(e.message || `An error occurred during export for template "${template.name}".`);
        console.error(e);
      }
    }

    this.isExporting.set(false);

    if (successCount > 0) {
      this.ref.close(true);
    }
  }

  private buildNotesView(lookupNotes: LookupNotes | undefined): void {
    if (!lookupNotes) {
      this.lookupNotesView.set([]);
      return;
    }

    const view: SelectionGroupView[] = Object.entries(lookupNotes).map(([selection, noteList]) => ({
      selection,
      notes: noteList.map((text, index) => ({text, originalIndex: index}))
    }));

    this.lookupNotesView.set(view);
  }

  private saveNotesIfChanged(): void {
    const project = this.data.project;
    const clipId = this.data.subtitleData.id;

    const finalLookupNotes: LookupNotes = {};
    for (const group of this.lookupNotesView()) {
      if (group.notes.length > 0) {
        // re-index the notes to get a clean, contiguous array
        finalLookupNotes[group.selection] = group.notes
          .sort((a, b) => a.originalIndex - b.originalIndex)
          .map(note => note.text);
      }
    }

    const finalNotes: ProjectClipNotes = {
      lookupNotes: finalLookupNotes,
      manualNote: this.manualNote()
    };

    if (!isEqual(this.initialNotes, finalNotes)) {
      const newProjectNotes = cloneDeep(project.notes ?? {});

      if (Object.keys(finalNotes.lookupNotes ?? {}).length > 0 || finalNotes.manualNote) {
        newProjectNotes[clipId] = finalNotes;
      } else {
        delete newProjectNotes[clipId];
      }

      this.appStateService.updateProject(project.id, {notes: newProjectNotes});

      // Update the baseline to the newly saved state for future comparisons
      this.initialNotes = cloneDeep(finalNotes);
    }
  }

  private saveSelectedTemplates(): void {
    const project = this.data.project;
    const selectedIds = this.selectedTemplates().map(t => t.id);

    // Only update if there's a change
    if (!isEqual(project.selectedAnkiTemplateIds, selectedIds)) {
      this.appStateService.updateProject(project.id, {selectedAnkiTemplateIds: selectedIds});
    }
  }

  private clearDebounceTimeout(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
  }
}
