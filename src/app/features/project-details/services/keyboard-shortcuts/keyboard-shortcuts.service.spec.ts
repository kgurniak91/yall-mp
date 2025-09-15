import { TestBed } from '@angular/core/testing';

import { KeyboardShortcutsService } from './keyboard-shortcuts.service';

xdescribe('KeyboardShortcutsService', () => {
  let service: KeyboardShortcutsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KeyboardShortcutsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
