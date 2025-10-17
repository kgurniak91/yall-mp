import {TestBed} from '@angular/core/testing';
import {ProjectKeyboardShortcutsService} from './project-keyboard-shortcuts.service';

xdescribe('ProjectKeyboardShortcutsService', () => {
  let service: ProjectKeyboardShortcutsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectKeyboardShortcutsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
