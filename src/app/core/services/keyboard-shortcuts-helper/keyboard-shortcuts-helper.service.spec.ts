import { TestBed } from '@angular/core/testing';

import { KeyboardShortcutsHelperService } from './keyboard-shortcuts-helper.service';

xdescribe('KeyboardShortcutsHelperService', () => {
  let service: KeyboardShortcutsHelperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KeyboardShortcutsHelperService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
