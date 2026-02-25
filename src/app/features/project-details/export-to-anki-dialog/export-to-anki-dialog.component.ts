import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import {
  AnkiBatchExportRequest,
  AnkiCardTemplate,
  AnkiConnectStatus,
  AnkiTemplateTarget,
  ExportToAnkiDialogData
} from '../../../model/anki.types';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
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
import {ProjectClipNotes} from '../../../model/project.types';
import {cloneDeep, escape, isEqual} from 'lodash-es';
import {AppStateService} from '../../../state/app/app-state.service';
import {Popover} from 'primeng/popover';
import {DialogOrchestrationService} from '../../../core/services/dialog-orchestration/dialog-orchestration.service';
import {GlobalSettingsTab} from '../../global-settings-dialog/global-settings-dialog.types';
import {Divider} from 'primeng/divider';
import {Chip} from 'primeng/chip';
import {TagsInputComponent} from '../../../shared/components/tags-input/tags-input.component';
import {Tooltip} from 'primeng/tooltip';
import {ProjectNotesComponent} from '../project-notes/project-notes.component';
import {Tag} from 'primeng/tag';
import {ConfirmationService} from 'primeng/api';
import {DEFAULT_CONFIRMATION} from '../../../shared/types/confirmation.types';

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
    ProjectNotesComponent,
    Tag
  ],
  templateUrl: './export-to-anki-dialog.component.html',
  styleUrl: './export-to-anki-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExportToAnkiDialogComponent implements OnInit, OnDestroy {
  protected readonly data: ExportToAnkiDialogData;
  protected readonly cardSpecificTags = signal<string[]>([]);
  protected readonly selectedTemplates = signal<AnkiCardTemplate[]>([]);
  protected readonly hint = signal<string>('');
  protected readonly isExporting = signal(false);
  protected readonly selectedSubtitleParts = signal<SubtitlePart[]>([]);

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

  protected readonly assSubtitleData = signal<AssSubtitleData | null>(null);
  protected readonly isAlreadyExported = signal(false);
  protected readonly exportTags = signal<string[]>([]);
  protected readonly ankiService = inject(AnkiStateService);
  protected readonly suspendCard = signal<boolean>(false);
  protected readonly currentNotes = signal<ProjectClipNotes | undefined>(undefined);
  protected readonly initialNotes = signal<ProjectClipNotes | undefined>(undefined);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly toastService = inject(ToastService);
  private readonly appStateService = inject(AppStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly elementRef = inject(ElementRef);
  private readonly confirmationService = inject(ConfirmationService);

  constructor() {
    this.data = this.config.data as ExportToAnkiDialogData;
  }

  ngOnInit() {
    const history = this.data.project.ankiExportHistory || [];
    this.isAlreadyExported.set(history.includes(this.data.subtitleData.id));

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
      this.assSubtitleData.set({
        ...assData,
        parts: sortedParts
      });

      // Pre-select all parts (from the now sorted list) by default
      this.selectedSubtitleParts.set([...sortedParts]);
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
    this.initialNotes.set(cloneDeep(projectNotes));
    this.currentNotes.set(this.initialNotes());
    this.hint.set(projectNotes?.hint || '');

    setTimeout(() => {
      if (this.isAlreadyExported()) {
        this.confirmationService.confirm({
          ...DEFAULT_CONFIRMATION,
          header: 'Potential Anki Duplicate',
          message: 'This clip has already been exported to Anki. Are you sure you want to export it again?',
          acceptLabel: this.data.instantExport ? 'Yes, export again immediately' : 'Yes, continue to export configuration',
          rejectLabel: 'Cancel',
          closeOnEscape: false,
          closable: false,
          accept: () => this.attemptInstantExport(),
          reject: () => this.onClose(),
        });
      } else {
        this.attemptInstantExport();
      }
    });
  }

  private attemptInstantExport() {
    if (this.data.instantExport) {
      this.toastService.info('Attempting instant export to Anki...');
      setTimeout(() => {
        this.onExport();
      });
    }
  }

  ngOnDestroy() {
    this.saveHintIfChanged();
    this.saveSelectedTemplates();
    this.savePostExportActions();
  }

  onNotesChanged(notes: ProjectClipNotes) {
    this.currentNotes.set(notes);
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
      this.toastService.warn('Please select at least one template to export');
      this.isExporting.set(false);
      this.revealDialog();
      return;
    }

    this.saveHintIfChanged();

    if (!this.finalTextPreview().trim()) {
      this.toastService.warn('Please select at least one subtitle part to export');
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

    const targets: AnkiTemplateTarget[] = [];

    for (const template of templates) {
      if (!template.ankiDeck || !template.ankiNoteType) {
        this.toastService.warn(`Skipping template "${template.name}" as it is incomplete`);
        continue;
      }

      const baseTags = this.exportTags();
      const templateTags = template.tags || [];
      const cardSpecificTags = this.cardSpecificTags() || [];
      const finalTags = Array.from(new Set([...baseTags, ...templateTags, ...cardSpecificTags]));

      targets.push({
        template,
        tags: finalTags
      });
    }

    if (targets.length === 0) {
      this.isExporting.set(false);
      this.revealDialog();
      return;
    }

    const batchRequest: AnkiBatchExportRequest = {
      subtitleData: subtitleForExport,
      mediaPath: project.mediaPath,
      exportTime,
      hint: this.hint(),
      notes: this.generateFormattedNotes(this.currentNotes()),
      suspend: this.suspendCard(),
      targets,
      audioTrackIndex: project.settings.selectedAudioTrackIndex
    };

    try {
      const result = await window.electronAPI.exportAnkiCardBatch(batchRequest);

      if (result.successCount > 0) {
        const countText = (result.successCount === 1) ? 'card' : 'cards';
        this.toastService.success(`Successfully created ${result.successCount} Anki ${countText}`);

        for (const target of targets) {
          this.ankiService.processDailyGoalProgress(target.template.id, 1);
        }

        const subtitleId = this.data.subtitleData.id;
        this.appStateService.addAnkiExportToHistory(this.data.project.id, subtitleId);

        this.ref.close(true);
      } else {
        this.toastService.error(result.error || 'Failed to export to Anki');
        this.revealDialog();
      }
    } catch (e: any) {
      this.toastService.error(e.message || 'An error occurred during export to Anki');
      console.error(e);
      this.revealDialog();
    } finally {
      this.isExporting.set(false);
    }
  }

  private generateFormattedNotes(notes: ProjectClipNotes | undefined): string {
    if (!notes) {
      return '';
    }

    const finalParts: string[] = [];

    // Process Lookup Notes
    if (notes.lookupNotes) {
      const sortedKeys = Object.keys(notes.lookupNotes);

      for (const selection of sortedKeys) {
        const noteList = notes.lookupNotes[selection];
        if (!noteList || noteList.length === 0) {
          continue;
        }

        let groupHtml = '';
        if (selection) {
          const escapedSelection = escape(selection);
          groupHtml = `<b>"${escapedSelection}"</b>:<br><ul>`;
        } else {
          groupHtml = `<b>General notes</b>:<br><ul>`;
        }

        for (const text of noteList) {
          let formattedNote = escape(text).trim().replace(/\n/g, '<br>');
          if (!formattedNote) formattedNote = '&nbsp;';
          groupHtml += `<li>${formattedNote}<br></li>`;
        }

        groupHtml += '</ul>';
        finalParts.push(groupHtml);
      }
    }

    // Preserve legacy manual note if it exists in data but not in UI
    if (notes.manualNote?.trim()) {
      let manualNoteHtml = '<b>Manual notes</b>:<br><ul>';
      let formattedManualNote = escape(notes.manualNote).replace(/\n/g, '<br>');
      if (!formattedManualNote) {
        formattedManualNote = '&nbsp;';
      }
      manualNoteHtml += `<li>${formattedManualNote}<br></li></ul>`;
      finalParts.push(manualNoteHtml);
    }

    return finalParts.join('');
  }

  private saveHintIfChanged(): void {
    const projectId = this.data.project.id;
    const clipId = this.data.subtitleData.id;
    const currentHint = this.hint();
    const originalHint = this.initialNotes()?.hint || '';

    if (currentHint !== originalHint) {
      const currentProject = this.appStateService.currentProject();

      if (!currentProject || currentProject.id !== projectId) {
        return;
      }

      const newProjectNotes = cloneDeep(currentProject.notes ?? {});
      const clipNotes = newProjectNotes[clipId] ?? {};

      clipNotes.hint = currentHint;

      const hasManualNote = Boolean(clipNotes.manualNote);
      const hasLookup = clipNotes.lookupNotes && Object.keys(clipNotes.lookupNotes).length > 0;
      const hasHint = Boolean(clipNotes.hint);

      if (!hasManualNote && !hasLookup && !hasHint) {
        delete newProjectNotes[clipId];
      } else {
        newProjectNotes[clipId] = clipNotes;
      }

      this.appStateService.updatePartialProject(projectId, {notes: newProjectNotes});
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
