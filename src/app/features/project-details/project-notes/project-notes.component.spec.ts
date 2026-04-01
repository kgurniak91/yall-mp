import {fakeAsync, flush, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {Subject} from 'rxjs';
import {MockBuilder} from 'ng-mocks';
import {createComponentFactory, Spectator} from '@ngneat/spectator';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {ProjectNotesComponent} from './project-notes.component';
import {AppStateService} from '../../../state/app/app-state.service';
import {DialogService} from 'primeng/dynamicdialog';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ConfirmationService} from 'primeng/api';
import {Project, ProjectClipNotes} from '../../../model/project.types';
import Spy = jasmine.Spy;

describe('ProjectNotesComponent', () => {
  const MOCK_NOTES_DATA: ProjectClipNotes = {
    lookupNotes: {
      'term a': ['First note for term a', 'Second note for term a'],
      'term b': ['First note for term b']
    }
  };

  const mockCurrentProject = signal<Project | null>(null);

  const dependencies = MockBuilder()
    .keep(ProjectNotesComponent)
    .mock(AppStateService, {
      currentProject: mockCurrentProject,
      updatePartialProject: () => {
      }
    })
    .mock(DialogService)
    .mock(ToastService)
    .mock(ConfirmationService)
    .build();

  const createComponent = createComponentFactory({
    component: ProjectNotesComponent,
    imports: [NoopAnimationsModule],
    ...dependencies
  });

  let spectator: Spectator<ProjectNotesComponent>;

  beforeEach(() => {
    spectator = createComponent({
      props: {
        projectId: 'project-123',
        clipId: 'clip-1',
        initialExpandAll: false,
        notesData: undefined
      }
    });
  });

  it('should display the empty state placeholder when there are no notes', () => {
    const placeholder = spectator.query('.notes-placeholder');
    expect(placeholder).toExist();
    expect(placeholder).toHaveText('No notes for this clip.');
    expect(spectator.query('p-accordion')).not.toExist();
  });

  it('should render the correct number of accordions based on lookup notes', () => {
    spectator.setInput('notesData', MOCK_NOTES_DATA);
    spectator.detectChanges();

    const headers = spectator.queryAll('p-accordion-header');
    expect(headers.length).toBe(2);

    expect(headers[0]).toHaveText('term a');
    expect(headers[0]).toHaveText('(2 notes)');

    expect(headers[1]).toHaveText('term b');
    expect(headers[1]).toHaveText('(1 note)');
  });

  describe('Accordion Expansion Logic', () => {
    it('should keep all accordions collapsed initially when initialExpandAll is false', () => {
      spectator.setInput('initialExpandAll', false);
      spectator.setInput('notesData', MOCK_NOTES_DATA);
      spectator.detectChanges();

      const headers = spectator.queryAll('p-accordion-header');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false');
      expect(headers[1]).toHaveAttribute('aria-expanded', 'false');
    });

    it('should expand all accordions initially when initialExpandAll is true', () => {
      spectator.setInput('initialExpandAll', true);
      spectator.setInput('notesData', MOCK_NOTES_DATA);
      spectator.detectChanges();

      const headers = spectator.queryAll('p-accordion-header');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(headers[1]).toHaveAttribute('aria-expanded', 'true');
    });

    it('should open an accordion when its header is clicked', fakeAsync(() => {
      spectator.setInput('initialExpandAll', false);
      spectator.setInput('notesData', MOCK_NOTES_DATA);
      spectator.detectChanges();

      const headers = spectator.queryAll('p-accordion-header');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false');

      // Click first accordion to expand
      spectator.click(headers[0]);
      tick();
      spectator.detectChanges();

      expect(headers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(headers[1]).toHaveAttribute('aria-expanded', 'false'); // Second remains collapsed
    }));

    it('should NOT re-evaluate initialExpandAll logic if clipId stays the same', fakeAsync(() => {
      spectator.setInput('initialExpandAll', true);
      spectator.setInput('clipId', 'clip-1');
      spectator.setInput('notesData', MOCK_NOTES_DATA);
      spectator.detectChanges();

      const headers = spectator.queryAll('p-accordion-header');

      // User manually collapses the accordion
      spectator.click(headers[0]);
      tick();
      spectator.detectChanges();
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false');

      // Notes data updates but clipId remains 'clip-1'
      const UPDATED_CLIP_DATA: ProjectClipNotes = {
        lookupNotes: {
          'term a': ['First note for term a', 'Second note for term a', 'Third note added']
        }
      };

      spectator.setInput('notesData', UPDATED_CLIP_DATA);
      spectator.detectChanges();

      // The accordion shouldn't magically pop back open, respecting the user's manual collapse state
      const updatedHeaders = spectator.queryAll('p-accordion-header');
      expect(updatedHeaders[0]).toHaveAttribute('aria-expanded', 'false');
    }));

    it('should keep the accordion open AND maintain order when a note is edited and its term is changed', fakeAsync(() => {
      // 1. Set up the component with 3 distinct groups
      spectator.setInput('initialExpandAll', true);
      spectator.setInput('notesData', {
        lookupNotes: {
          'group1': ['note 1'],
          'group2': ['note 2'],
          'group3': ['note 3']
        }
      });
      spectator.detectChanges();

      let headers = spectator.queryAll('p-accordion-header');
      expect(headers.length).toBe(3);
      expect(headers[0]).toHaveText('group1');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'true');

      // 2. Mock DialogService to return a modified term
      const dialogService = spectator.inject(DialogService);
      const onCloseSubject = new Subject<any>();
      (dialogService.open as Spy).and.returnValue({onClose: onCloseSubject} as any);

      // 3. Open the Note Menu for the FIRST group via DOM
      const noteMenuBtn = spectator.query('.note-item button');
      expect(noteMenuBtn).toExist();
      spectator.click(noteMenuBtn!);
      spectator.detectChanges();

      // Use flush() to ensure PrimeNG completely resolves DOM overlay animations/timeouts
      flush();

      // 4. Find and click the "Edit note" menu item from the DOM (appended to body by PrimeNG)
      const menuItems = Array.from(document.querySelectorAll('.p-menuitem-text, .p-menuitem-link, span'));
      const editMenuSpan = menuItems.find(el => el.textContent?.trim() === 'Edit note') as HTMLElement;

      expect(editMenuSpan).toBeTruthy('Could not find "Edit note" menu item in the DOM');
      editMenuSpan.click();
      spectator.detectChanges();
      flush();

      expect(dialogService.open).toHaveBeenCalled();

      // 5. Simulate the dialog saving the note with a new term
      onCloseSubject.next({term: 'group1-edited', noteText: 'My edited note'});
      flush();
      spectator.detectChanges();

      // 6. Verify the new term group rendered, remains OPEN, and stayed at the TOP of the list
      headers = spectator.queryAll('p-accordion-header');
      expect(headers.length).toBe(3);

      // Order should be preserved: group1-edited, group2, group3
      expect(headers[0]).toHaveText('group1-edited');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'true'); // Verifies it didn't auto-close

      expect(headers[1]).toHaveText('group2');
      expect(headers[2]).toHaveText('group3');
    }));

    it('should keep the accordion collapsed when its term is renamed if the user manually collapsed it prior', fakeAsync(() => {
      // 1. Set up the component with a single group
      spectator.setInput('initialExpandAll', true);
      spectator.setInput('notesData', {
        lookupNotes: {
          'group1': ['note 1']
        }
      });
      spectator.detectChanges();

      let headers = spectator.queryAll('p-accordion-header');
      expect(headers.length).toBe(1);
      expect(headers[0]).toHaveText('group1');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'true'); // Initially expanded

      // 2. User manually collapses the accordion
      spectator.click(headers[0]);
      flush(); // Allow PrimeNG animation to finish
      spectator.detectChanges();

      headers = spectator.queryAll('p-accordion-header');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false'); // Now collapsed

      // 3. Mock DialogService to simulate editing the term
      const dialogService = spectator.inject(DialogService);
      const onCloseSubject = new Subject<any>();
      (dialogService.open as Spy).and.returnValue({onClose: onCloseSubject} as any);

      // 4. Open the Group Menu via DOM (.header-menu-overlay instead of .note-item)
      const groupMenuBtn = spectator.query('.header-menu-overlay button');
      expect(groupMenuBtn).toExist();
      spectator.click(groupMenuBtn!);
      spectator.detectChanges();
      flush(); // Resolve PrimeNG overlay rendering

      // 5. Find and click the "Edit term" menu item from the DOM
      const menuItems = Array.from(document.querySelectorAll('.p-menuitem-text, .p-menuitem-link, span'));
      const editMenuSpan = menuItems.find(el => el.textContent?.trim() === 'Edit term') as HTMLElement;

      expect(editMenuSpan).toBeTruthy('Could not find "Edit term" menu item in the DOM');
      editMenuSpan.click();
      spectator.detectChanges();
      flush();

      expect(dialogService.open).toHaveBeenCalled();

      // 6. Simulate the dialog saving the newly renamed term
      onCloseSubject.next({term: 'group1-renamed'}); // Note text is undefined for rename mode
      flush();
      spectator.detectChanges();

      // 7. Verify the group was renamed BUT remained closed
      headers = spectator.queryAll('p-accordion-header');
      expect(headers.length).toBe(1);
      expect(headers[0]).toHaveText('group1-renamed');
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false'); // Must still be collapsed
    }));
  });
});
