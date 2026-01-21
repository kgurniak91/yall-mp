import {ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked} from '@angular/core';
import {Button} from 'primeng/button';
import {Popover} from 'primeng/popover';
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel} from 'primeng/accordion';
import {I18nPluralPipe} from '@angular/common';
import {Divider} from 'primeng/divider';
import {Tooltip} from 'primeng/tooltip';
import {ProjectClipNotes} from '../../../model/project.types';
import {DialogService} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ConfirmationService} from 'primeng/api';
import {AppStateService} from '../../../state/app/app-state.service';
import {NoteFormDialogData, NoteFormResult} from '../note-form-dialog/note-form-dialog.types';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {NoteFormDialogComponent} from '../note-form-dialog/note-form-dialog.component';
import {take} from 'rxjs';
import {cloneDeep, escape} from 'lodash-es';

interface NoteViewItem {
  text: string;
  originalIndex: number;
}

interface SelectionGroupView {
  selection: string;
  notes: NoteViewItem[];
}

@Component({
  selector: 'app-project-notes',
  imports: [
    Button,
    Popover,
    Accordion,
    AccordionPanel,
    AccordionHeader,
    AccordionContent,
    I18nPluralPipe,
    Divider,
    Tooltip
  ],
  templateUrl: './project-notes.component.html',
  styleUrl: './project-notes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProjectNotesComponent {
  public readonly projectId = input.required<string>();
  public readonly clipId = input.required<string>();
  public readonly initialExpandAll = input(false);
  public readonly notesData = input<ProjectClipNotes | undefined>();
  public readonly notesChange = output<ProjectClipNotes>();
  protected readonly lookupNotesView = signal<SelectionGroupView[]>([]);
  protected readonly activeAccordionIndices = signal<number[]>([]);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly appStateService = inject(AppStateService);
  private currentNotes: ProjectClipNotes | undefined;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const clipId = this.clipId();
      const inputData = this.notesData();
      let notes: ProjectClipNotes | undefined;

      if (inputData !== undefined) {
        notes = inputData;
      } else {
        const project = this.appStateService.currentProject();
        if (project && project.id === projectId) {
          notes = project.notes?.[clipId];
        }
      }

      untracked(() => {
        this.currentNotes = cloneDeep(notes);
        this.buildNotesView(notes);
      });
    });
  }

  onAddManualNote(): void {
    this.openNoteDialog('create', '', '', true);
  }

  onAddNoteToGroup(term: string): void {
    this.openNoteDialog('create', term, '', false);
  }

  onEditNote(term: string, note: NoteViewItem): void {
    this.openNoteDialog('edit', term, note.text, true, note.originalIndex);
  }

  onDeleteNote(selection: string, noteIndex: number): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: 'Are you sure you want to delete this note?',
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
          }).filter(group => group.notes.length > 0);
        });
        this.saveNotes();
        this.toastService.success('Note removed');
      }
    });
  }

  formatNoteText(text: string): string {
    return escape(text).replace(/\n/g, '<br>');
  }

  private buildNotesView(notes: ProjectClipNotes | undefined): void {
    if (!notes?.lookupNotes && !notes?.manualNote) {
      this.lookupNotesView.set([]);
      this.activeAccordionIndices.set([]);
      return;
    }

    const view: SelectionGroupView[] = [];

    // Process Lookup Notes
    if (notes.lookupNotes) {
      Object.entries(notes.lookupNotes).forEach(([selection, noteList]) => {
        view.push({
          selection,
          notes: noteList.map((text, index) => ({text, originalIndex: index}))
        });
      });
    }

    // Process Legacy Manual Note (convert to "General notes" group)
    if (notes.manualNote) {
      const generalGroup = view.find(g => g.selection === '');
      if (generalGroup) {
        // If "General notes" already exists, add manual note to it at the end
        generalGroup.notes.push({text: notes.manualNote, originalIndex: 9999});
      } else {
        view.push({
          selection: '',
          notes: [{text: notes.manualNote, originalIndex: 0}]
        });
      }
    }

    this.lookupNotesView.set(this.sortGroups(view));

    if (this.initialExpandAll()) {
      this.activeAccordionIndices.set(view.map((_, i) => i));
    }
  }

  private sortGroups(groups: SelectionGroupView[]): SelectionGroupView[] {
    return groups.sort((a, b) => {
      if (!a.selection) {
        return -1;
      }
      if (!b.selection) {
        return 1;
      }
      return a.selection.localeCompare(b.selection);
    });
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

    dialogRef.onClose.pipe(take(1)).subscribe((result: NoteFormResult | undefined) => {
      scheduleRestoreFocus(restoreFocusability);

      if (!result) {
        return;
      }

      this.lookupNotesView.update(currentView => {
        const newView = cloneDeep(currentView);

        // Remove old note if editing
        if (mode === 'edit' && originalIndex !== undefined) {
          const oldGroupIndex = newView.findIndex(g => g.selection === term);
          if (oldGroupIndex > -1) {
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

      this.saveNotes();
      this.toastService.success(mode === 'create' ? 'Note added.' : 'Note updated.');
    });
  }

  private saveNotes(): void {
    const project = this.appStateService.currentProject();
    if (!project) {
      return;
    }

    // Reconstruct the ProjectClipNotes object from the View
    const finalLookupNotes: Record<string, string[]> = {};
    let hint = this.currentNotes?.hint || ''; // Preserve hint

    for (const group of this.lookupNotesView()) {
      if (group.notes.length > 0) {
        finalLookupNotes[group.selection] = group.notes
          .sort((a, b) => a.originalIndex - b.originalIndex)
          .map(note => note.text);
      }
    }

    const finalNotes: ProjectClipNotes = {
      lookupNotes: finalLookupNotes,
      manualNote: undefined, // Cleared to migrate legacy manual notes into the lookupNotes array format
      hint: hint
    };

    // Save notes in app state
    const newProjectNotes = cloneDeep(project.notes ?? {});
    if (Object.keys(finalNotes.lookupNotes ?? {}).length > 0 || finalNotes.hint) {
      newProjectNotes[this.clipId()] = finalNotes;
    } else {
      delete newProjectNotes[this.clipId()];
    }

    this.appStateService.updatePartialProject(this.projectId(), {notes: newProjectNotes});
    this.currentNotes = finalNotes;
    this.notesChange.emit(finalNotes);
  }
}
