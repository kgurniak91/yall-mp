import {Component, computed, ElementRef, inject, OnDestroy, OnInit, signal} from '@angular/core';
import {
  AnkiCardTemplate,
  AnkiConnectStatus,
  AnkiExportRequest,
  ExportToAnkiDialogData
} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DialogService, DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {
  AssSubtitleData,
  DialogSubtitlePart,
  SubtitleData,
  SubtitlePart
} from '../../../../../shared/types/subtitle.type';
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
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel} from "primeng/accordion";
import {ConfirmationService} from 'primeng/api';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {Tag} from 'primeng/tag';
import {DecimalPipe, I18nPluralPipe} from '@angular/common';
import {NoteFormDialogData, NoteFormResult} from '../note-form-dialog/note-form-dialog.types';
import {NoteFormDialogComponent} from '../note-form-dialog/note-form-dialog.component';

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
    Tooltip,
    Accordion,
    AccordionPanel,
    AccordionHeader,
    AccordionContent,
    Tag,
    DecimalPipe,
    I18nPluralPipe
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss'
})
export class ExportToAnkiDialogComponent implements OnInit, OnDestroy {
  protected readonly data: ExportToAnkiDialogData;
  protected readonly cardSpecificTags = signal<string[]>([]);
  protected readonly selectedTemplates = signal<AnkiCardTemplate[]>([]);
  protected readonly hint = signal<string>('');
  protected readonly isExporting = signal(false);
  protected readonly selectedSubtitleParts = signal<SubtitlePart[]>([]);
  protected readonly activeNoteAccordionIndices = signal<number[]>([]);
  protected readonly finalTextPreview = computed(() => {
    if (this.data.subtitleData.type === 'srt') {
      return this.data.subtitleData.text;
    } else {
      return this.selectedSubtitleParts().map(p => p.text).join('\n');
    }
  });
  protected readonly finalTextPreviewHtml = computed(() => {
    const text = this.finalTextPreview();
    return text.replace(/\n/g, '<br>');
  });
  protected readonly lookupNotesView = signal<SelectionGroupView[]>([]);
  protected readonly formattedAnkiNotes = computed(() => {
    const finalParts: string[] = [];

    // Process Lookup Notes
    for (const group of this.lookupNotesView()) {
      const selection = group.selection;
      let groupHtml = '';

      if (selection) {
        const escapedSelection = escape(selection);
        groupHtml = `<b>"${escapedSelection}"</b>:<br><ul>`;
      } else {
        groupHtml = `<b>General notes</b>:<br><ul>`;
      }

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

    // Preserve legacy manual note if it exists in data but not in UI
    const legacyManualNote = this.initialNotes?.manualNote?.trim();
    if (legacyManualNote) {
      let manualNoteHtml = '<b>Manual notes</b>:<br><ul>';
      let formattedManualNote = escape(legacyManualNote).replace(/\n/g, '<br>');
      if (!formattedManualNote) {
        formattedManualNote = '&nbsp;';
      }
      manualNoteHtml += `<li>${formattedManualNote}<br></li></ul>`;
      finalParts.push(manualNoteHtml);
    }

    return finalParts.join('');
  });
  protected assSubtitleData: AssSubtitleData | null = null;
  protected clipDuration!: number;
  protected isAlreadyExported!: boolean;
  protected readonly exportTags = signal<string[]>([]);
  protected readonly ankiService = inject(AnkiStateService);
  protected readonly suspendCard = signal<boolean>(false);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly toastService = inject(ToastService);
  private readonly appStateService = inject(AppStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly elementRef = inject(ElementRef);
  private initialNotes: ProjectClipNotes | undefined;

  constructor() {
    this.data = this.config.data as ExportToAnkiDialogData;
  }

  ngOnInit() {
    this.clipDuration = this.data.subtitleData.endTime - this.data.subtitleData.startTime;
    const history = this.data.project.ankiExportHistory || [];
    this.isAlreadyExported = history.includes(this.data.subtitleData.id);

    if (this.data.subtitleData.type === 'ass') {
      const assData = this.data.subtitleData as AssSubtitleData & { parts: DialogSubtitlePart[] };

      // Sort the parts before assigning them
      const sortedParts = [...assData.parts].sort((a, b) => {
        // Primary sort: by track number, DESCENDING (e.g., Track 2 before Track 1)
        if (a.track !== b.track) {
          return b.track - a.track;
        }
        // Secondary sort: by y-coordinate, ASCENDING (higher on screen comes first)
        return (a.y ?? Infinity) - (b.y ?? Infinity);
      });

      // Create a new AssSubtitleData object with the sorted parts
      this.assSubtitleData = {
        ...assData,
        parts: sortedParts
      };

      // Pre-select all parts (from the now sorted list) by default
      this.selectedSubtitleParts.set([...this.assSubtitleData.parts]);
    }

    const project = this.data.project;
    this.suspendCard.set(project.lastAnkiSuspendState ?? false);
    const globalTags = this.ankiService.ankiGlobalTags();
    const projectTags = project.ankiTags || [];
    this.exportTags.set(Array.from(new Set([...globalTags, ...projectTags])));

    if (project.selectedAnkiTemplateIds) {
      const preselectedTemplates = this.ankiService.ankiCardTemplates().filter(t => project.selectedAnkiTemplateIds!.includes(t.id));
      this.selectedTemplates.set(preselectedTemplates);
    }

    const projectNotes = this.data.project.notes?.[this.data.subtitleData.id];
    this.initialNotes = cloneDeep(projectNotes);
    this.hint.set(projectNotes?.hint || '');
    this.buildNotesView(projectNotes?.lookupNotes);

    if (this.data.instantExport) {
      this.toastService.info('Attempting instant export to Anki...');
      setTimeout(() => {
        this.onExport();
      });
    }
  }

  ngOnDestroy() {
    this.saveNotesIfChanged();
    this.saveSelectedTemplates();
    this.savePostExportActions();
  }

  onAddNoteToGroup(term: string): void {
    this.openNoteDialog('create', term, '', true);
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

  onAddManualNote(): void {
    this.openNoteDialog('create', '', '', true);
  }

  onEditNote(term: string, note: NoteViewItem): void {
    this.openNoteDialog('edit', term, note.text, true, note.originalIndex);
  }

  formatNoteText(text: string): string {
    return escape(text).replace(/\n/g, '<br>');
  }

  onDeleteNote(selection: string, noteIndex: number): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Are you sure you want to delete this note?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => {
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
    });
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
      this.revealDialog();
      return;
    }

    const templates = this.selectedTemplates();
    if (templates.length === 0) {
      this.toastService.warn('Please select at least one template to export.');
      this.isExporting.set(false);
      this.revealDialog();
      return;
    }

    this.saveNotesIfChanged();

    if (!this.finalTextPreview().trim()) {
      this.toastService.warn('Please select at least one subtitle part to export.');
      this.isExporting.set(false);
      this.revealDialog();
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
        hint: this.hint(),
        notes: this.formattedAnkiNotes(),
        tags: finalTags,
        suspend: this.suspendCard()
      };

      try {
        const result = await window.electronAPI.exportAnkiCard(request);
        if (result.cardId) {
          this.toastService.success(`Successfully created Anki card for template "${template.name}"`);
          successCount++;

          const subtitleId = this.data.subtitleData.id;
          this.appStateService.addAnkiExportToHistory(this.data.project.id, subtitleId);
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
    } else {
      this.revealDialog();
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

    this.lookupNotesView.set(this.sortGroups(view));
  }

  private openNoteDialog(
    mode: 'create' | 'edit',
    term: string,
    noteText: string,
    isTermEditable: boolean,
    originalIndex?: number
  ): void {
    const restoreFocusability = disableFocusInParentDialog();

    const data: NoteFormDialogData = {
      mode,
      term,
      noteText,
      isTermEditable
    };

    const dialogRef = this.dialogService.open(NoteFormDialogComponent, {
      header: mode === 'create' ? 'Add note' : 'Edit note',
      modal: true,
      width: 'clamp(20rem, 95vw, 35rem)',
      closeOnEscape: false,
      data: data
    });

    dialogRef.onClose.subscribe((result: NoteFormResult | undefined) => {
      scheduleRestoreFocus(restoreFocusability);

      if (!result) {
        return;
      }

      this.lookupNotesView.update(currentView => {
        const newView = cloneDeep(currentView);

        if (mode === 'edit' && originalIndex !== undefined) {
          // Find old group
          const oldGroupIndex = newView.findIndex(g => g.selection === term);
          if (oldGroupIndex > -1) {
            // Remove from old group
            newView[oldGroupIndex].notes = newView[oldGroupIndex].notes.filter(n => n.originalIndex !== originalIndex);
            if (newView[oldGroupIndex].notes.length === 0) {
              newView.splice(oldGroupIndex, 1);
            }
          }
        }

        // Add to new group (either existing or new)
        let targetGroup = newView.find(g => g.selection === result.term);
        if (!targetGroup) {
          targetGroup = {selection: result.term, notes: []};
          newView.push(targetGroup);
        }

        // Use a temporary index for the UI; save logic will re-index everything
        const newNoteIndex = targetGroup.notes.length > 0
          ? Math.max(...targetGroup.notes.map(n => n.originalIndex)) + 1
          : 0;

        targetGroup.notes.push({text: result.noteText, originalIndex: newNoteIndex});

        return this.sortGroups(newView);
      });

      this.saveNotesIfChanged();
      this.toastService.success(mode === 'create' ? 'Note added.' : 'Note updated.');
    });
  }

  private sortGroups(groups: SelectionGroupView[]): SelectionGroupView[] {
    return groups.sort((a, b) => {
      // Empty selection string means "General notes" - always on top
      if (!a.selection) {
        return -1;
      }
      if (!b.selection) {
        return 1;
      }
      return a.selection.localeCompare(b.selection);
    });
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
      manualNote: this.initialNotes?.manualNote,
      hint: this.hint()
    };

    if (!isEqual(this.initialNotes, finalNotes)) {
      const newProjectNotes = cloneDeep(project.notes ?? {});

      if (Object.keys(finalNotes.lookupNotes ?? {}).length > 0 || finalNotes.manualNote || finalNotes.hint) {
        newProjectNotes[clipId] = finalNotes;
      } else {
        delete newProjectNotes[clipId];
      }

      this.appStateService.updatePartialProject(project.id, {notes: newProjectNotes});

      // Update the baseline to the newly saved state for future comparisons
      this.initialNotes = cloneDeep(finalNotes);
    }
  }

  private saveSelectedTemplates(): void {
    const project = this.data.project;
    const selectedIds = this.selectedTemplates().map(t => t.id);

    // Only update if there's a change
    if (!isEqual(project.selectedAnkiTemplateIds, selectedIds)) {
      this.appStateService.updatePartialProject(project.id, {selectedAnkiTemplateIds: selectedIds});
    }
  }

  private savePostExportActions(): void {
    const project = this.data.project;
    const lastSuspendState = this.suspendCard();

    if (project.lastAnkiSuspendState !== lastSuspendState) {
      this.appStateService.updatePartialProject(project.id, {
        lastAnkiSuspendState: lastSuspendState
      });
    }
  }

  private revealDialog(): void {
    if (!this.data.instantExport) {
      return;
    }

    const dialogWrapper = this.elementRef.nativeElement.closest('.p-dialog');
    if (dialogWrapper) {
      dialogWrapper.classList.remove('instant-anki-export-hidden');
    }
  }
}
