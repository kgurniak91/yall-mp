import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChildren
} from '@angular/core';
import {Button} from 'primeng/button';
import {Popover} from 'primeng/popover';
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel} from 'primeng/accordion';
import {I18nPluralPipe} from '@angular/common';
import {Divider} from 'primeng/divider';
import {Tooltip} from 'primeng/tooltip';
import {Menu} from 'primeng/menu';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {ProjectClipNotes} from '../../../model/project.types';
import {DialogService} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {AppStateService} from '../../../state/app/app-state.service';
import {NoteFormDialogData, NoteFormResult} from '../note-form-dialog/note-form-dialog.types';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {NoteFormDialogComponent} from '../note-form-dialog/note-form-dialog.component';
import {take} from 'rxjs';
import {cloneDeep, escape} from 'lodash-es';
import {DEFAULT_CONFIRMATION} from '../../../shared/types/confirmation.types';

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
    Tooltip,
    Menu
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
  protected readonly activeAccordionTabs = signal<string[]>([]);
  protected readonly groupMenuItems = signal<MenuItem[]>([]);
  protected readonly noteMenuItems = signal<MenuItem[]>([]);
  protected readonly groupMenus = viewChildren<Menu>('groupMenu');
  protected readonly noteMenus = viewChildren<Menu>('noteMenu');

  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly appStateService = inject(AppStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  private currentNotes: ProjectClipNotes | undefined;
  private lastProcessedClipId: string | null = null;

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

        // Only force expand after switching to a different clip
        if (this.initialExpandAll() && this.lastProcessedClipId !== clipId) {
          const view = this.lookupNotesView();
          this.activeAccordionTabs.set(view.map(g => g.selection));
          this.lastProcessedClipId = clipId;
        }
      });
    });
  }

  onAddManualNote(): void {
    this.openNoteDialog('create', '', '', true, undefined, true);
  }

  formatNoteText(text: string): string {
    return escape(text).replace(/\n/g, '<br>');
  }

  prepareGroupMenu(event: MouseEvent, menu: Menu, group: SelectionGroupView, index: number): void {
    this.noteMenus().forEach(m => m.hide());

    const items: MenuItem[] = [];

    items.push({
      label: 'Add another note',
      icon: 'fa-solid fa-plus',
      command: () => this.onAddNoteToGroup(group.selection)
    });

    items.push({
      label: 'Edit term',
      icon: 'fa-solid fa-pencil',
      command: () => this.onEditGroupTerm(group.selection)
    });

    const canMoveUp = index > 0;
    const canMoveDown = index < this.lookupNotesView().length - 1;

    if (canMoveUp || canMoveDown) {
      items.push({separator: true});
    }

    if (canMoveUp) {
      items.push({
        label: 'Move to Top',
        icon: 'fa-solid fa-arrow-right-to-bracket fa-rotate-270',
        command: () => this.onMoveGroupEdge(index, 'top')
      });
      items.push({label: 'Move Up', icon: 'fa-solid fa-arrow-up', command: () => this.onMoveGroup(index, -1)});
    }

    if (canMoveDown) {
      items.push({label: 'Move Down', icon: 'fa-solid fa-arrow-down', command: () => this.onMoveGroup(index, 1)});
      items.push({
        label: 'Move to Bottom',
        icon: 'fa-solid fa-arrow-right-to-bracket fa-rotate-90',
        command: () => this.onMoveGroupEdge(index, 'bottom')
      });
    }

    items.push({separator: true});

    items.push({
      label: 'Delete group',
      icon: 'fa-solid fa-trash',
      styleClass: 'text-red-500',
      command: () => this.onDeleteGroup(group.selection)
    });

    this.groupMenuItems.set(items);
    this.cdr.detectChanges(); // Sync model before menu evaluates toggle
    menu.toggle(event);
  }

  prepareNoteMenu(event: MouseEvent, menu: Menu, group: SelectionGroupView, note: NoteViewItem, groupIndex: number, noteIndex: number): void {
    this.groupMenus().forEach(m => m.hide());

    const items: MenuItem[] = [];

    items.push({
      label: 'Edit note',
      icon: 'fa-solid fa-pencil',
      command: () => this.onEditNote(group.selection, note)
    });

    const canMoveUp = noteIndex > 0;
    const canMoveDown = noteIndex < group.notes.length - 1;

    if (canMoveUp || canMoveDown) {
      items.push({separator: true});
    }

    if (canMoveUp) {
      items.push({
        label: 'Move to Top',
        icon: 'fa-solid fa-arrow-right-to-bracket fa-rotate-270',
        command: () => this.onMoveNoteEdge(groupIndex, noteIndex, 'top')
      });
      items.push({
        label: 'Move Up',
        icon: 'fa-solid fa-arrow-up',
        command: () => this.onMoveNote(groupIndex, noteIndex, -1)
      });
    }

    if (canMoveDown) {
      items.push({
        label: 'Move Down',
        icon: 'fa-solid fa-arrow-down',
        command: () => this.onMoveNote(groupIndex, noteIndex, 1)
      });
      items.push({
        label: 'Move to Bottom',
        icon: 'fa-solid fa-arrow-right-to-bracket fa-rotate-90',
        command: () => this.onMoveNoteEdge(groupIndex, noteIndex, 'bottom')
      });
    }

    items.push({separator: true});

    items.push({
      label: 'Delete note',
      icon: 'fa-solid fa-trash',
      styleClass: 'text-red-500',
      command: () => this.onDeleteNote(group.selection, note.originalIndex)
    });

    this.noteMenuItems.set(items);
    this.cdr.detectChanges(); // Sync model before menu evaluates toggle
    menu.toggle(event);
  }

  private onAddNoteToGroup(term: string): void {
    this.openNoteDialog('create', term, '', false);
  }

  private onEditGroupTerm(oldTerm: string): void {
    this.openNoteDialog('rename-term', oldTerm, '', true);
  }

  private onEditNote(term: string, note: NoteViewItem): void {
    this.openNoteDialog('edit', term, note.text, true, note.originalIndex);
  }

  private syncAccordionTabs(newView: SelectionGroupView[]): void {
    const currentTabs = this.activeAccordionTabs();
    this.activeAccordionTabs.set(currentTabs.filter(tab => newView.some(g => g.selection === tab)));
  }

  private onMoveGroup(index: number, direction: -1 | 1): void {
    const oldView = this.lookupNotesView();
    this.lookupNotesView.update(view => {
      const newView = cloneDeep(view);
      const temp = newView[index];
      newView[index] = newView[index + direction];
      newView[index + direction] = temp;
      return newView;
    });

    this.syncAccordionTabs(this.lookupNotesView());
    this.saveNotes();
  }

  private onMoveGroupEdge(index: number, edge: 'top' | 'bottom'): void {
    const oldView = this.lookupNotesView();
    this.lookupNotesView.update(view => {
      const newView = cloneDeep(view);
      const [item] = newView.splice(index, 1);

      if (edge === 'top') {
        newView.unshift(item);
      } else {
        newView.push(item);
      }

      return newView;
    });

    this.syncAccordionTabs(this.lookupNotesView());
    this.saveNotes();
  }

  private onMoveNote(groupIndex: number, noteIndex: number, direction: -1 | 1): void {
    this.lookupNotesView.update(view => {
      const newView = cloneDeep(view);
      const notes = newView[groupIndex].notes;
      const temp = notes[noteIndex];
      notes[noteIndex] = notes[noteIndex + direction];
      notes[noteIndex + direction] = temp;
      notes.forEach((n, i) => n.originalIndex = i); // Keep index synced
      return newView;
    });
    this.saveNotes();
  }

  private onMoveNoteEdge(groupIndex: number, noteIndex: number, edge: 'top' | 'bottom'): void {
    this.lookupNotesView.update(view => {
      const newView = cloneDeep(view);
      const notes = newView[groupIndex].notes;
      const [item] = notes.splice(noteIndex, 1);

      if (edge === 'top') {
        notes.unshift(item);
      } else {
        notes.push(item);
      }

      notes.forEach((n, i) => n.originalIndex = i); // Keep index synced
      return newView;
    });
    this.saveNotes();
  }

  private onDeleteGroup(term: string): void {
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Confirm deletion',
      message: 'Are you sure you want to delete all notes in this group?',
      accept: () => {
        this.lookupNotesView.update(view => view.filter(g => g.selection !== term));
        this.syncAccordionTabs(this.lookupNotesView());
        this.saveNotes();
        this.toastService.success('Group deleted');
      }
    });
  }

  private onDeleteNote(selection: string, noteIndex: number): void {
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Confirm deletion',
      message: 'Are you sure you want to delete this note?',
      accept: () => {
        this.lookupNotesView.update(currentView => {
          return currentView.map(group => {
            if (group.selection === selection) {
              const filtered = group.notes.filter(note => note.originalIndex !== noteIndex);
              filtered.forEach((n, i) => n.originalIndex = i); // Keep index synced
              return {...group, notes: filtered};
            }
            return group;
          }).filter(group => group.notes.length > 0);
        });
        this.saveNotes();
        this.toastService.success('Note removed');
      }
    });
  }

  private buildNotesView(notes: ProjectClipNotes | undefined): void {
    if (!notes?.lookupNotes && !notes?.manualNote) {
      this.lookupNotesView.set([]);
      if (!this.initialExpandAll()) {
        this.activeAccordionTabs.set([]);
      }
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
        generalGroup.notes.push({text: notes.manualNote, originalIndex: generalGroup.notes.length});
      } else {
        view.unshift({
          selection: '',
          notes: [{text: notes.manualNote, originalIndex: 0}]
        });
      }
    }

    this.lookupNotesView.set(view);
  }

  private handleRenameTerm(oldTerm: string, newTerm: string): void {
    if (oldTerm === newTerm) {
      return;
    }

    this.lookupNotesView.update(currentView => {
      const newView = cloneDeep(currentView);
      const oldGroupIndex = newView.findIndex(g => g.selection === oldTerm);
      const targetGroupIndex = newView.findIndex(g => g.selection === newTerm);

      if (targetGroupIndex > -1 && targetGroupIndex !== oldGroupIndex) {
        newView[targetGroupIndex].notes.push(...newView[oldGroupIndex].notes);
        newView.splice(oldGroupIndex, 1);
        newView[targetGroupIndex].notes.forEach((n, i) => n.originalIndex = i);
      } else if (oldGroupIndex > -1) {
        newView[oldGroupIndex].selection = newTerm;
      }
      return newView;
    });

    this.activeAccordionTabs.update(tabs =>
      tabs.map(t => t === oldTerm ? newTerm : t)
    );

    this.saveNotes();
    this.toastService.success('Term renamed');
  }

  private openNoteDialog(
    mode: 'create' | 'edit' | 'rename-term',
    term: string,
    noteText: string,
    isTermEditable: boolean,
    originalIndex?: number,
    forceExpand: boolean = false
  ): void {
    const restoreFocusability = disableFocusInParentDialog();

    const data: NoteFormDialogData = {
      mode,
      term,
      noteText,
      isTermEditable
    };

    const headerMap = {
      'create': 'Add note',
      'edit': 'Edit note',
      'rename-term': 'Edit term'
    };

    const dialogRef = this.dialogService.open(NoteFormDialogComponent, {
      header: headerMap[mode],
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

      if (mode === 'rename-term') {
        this.handleRenameTerm(term, result.term);
        return;
      }

      this.lookupNotesView.update(currentView => {
        const newView = cloneDeep(currentView);
        let spliceIndex = -1; // Track where the group was before edit to maintain order

        // If editing and the term hasn't changed, just update the text in-place
        if (mode === 'edit' && term === result.term && originalIndex !== undefined) {
          const targetGroup = newView.find(g => g.selection === term);
          if (targetGroup) {
            const noteToEdit = targetGroup.notes.find(n => n.originalIndex === originalIndex);
            if (noteToEdit) {
              noteToEdit.text = result.noteText!;
            }
          }
          return newView;
        }

        // Applies only if creating a new note or moving an existing note to a DIFFERENT term
        if (mode === 'edit' && originalIndex !== undefined) {
          const oldGroupIndex = newView.findIndex(g => g.selection === term);
          if (oldGroupIndex > -1) {
            newView[oldGroupIndex].notes = newView[oldGroupIndex].notes.filter(n => n.originalIndex !== originalIndex);
            if (newView[oldGroupIndex].notes.length === 0) {
              newView.splice(oldGroupIndex, 1);
              spliceIndex = oldGroupIndex;
            } else {
              newView[oldGroupIndex].notes.forEach((n, i) => n.originalIndex = i);
            }
          }
        }

        // Add to new group (either existing or new)
        let targetGroup = newView.find(g => g.selection === result.term);
        if (!targetGroup) {
          targetGroup = {selection: result.term, notes: []};

          if (spliceIndex > -1) {
            // Re-insert exactly where the emptied group used to be
            newView.splice(spliceIndex, 0, targetGroup);
          } else {
            // Append to the end if no group was completely emptied
            newView.push(targetGroup);
          }
        }

        targetGroup.notes.push({text: result.noteText!, originalIndex: targetGroup.notes.length});

        return newView;
      });

      // Expand accordion if new, forced, OR if term was edited
      if (forceExpand || mode === 'create' || term !== result.term) {
        this.activeAccordionTabs.update(tabs =>
          Array.from(new Set([...tabs, result.term]))
        );
      }

      this.saveNotes();
      this.toastService.success(mode === 'create' ? 'Note added' : 'Note updated');
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
