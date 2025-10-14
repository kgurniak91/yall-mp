import { TestBed } from '@angular/core/testing';

import { GlobalKeyboardShortcutsService } from './global-keyboard-shortcuts.service';

xdescribe('GlobalKeyboardShortcutsService', () => {
  let service: GlobalKeyboardShortcutsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GlobalKeyboardShortcutsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
