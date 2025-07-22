import { TestBed } from '@angular/core/testing';

import { AnkiStateService } from './anki-state.service';

describe('AnkiStateService', () => {
  let service: AnkiStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AnkiStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
