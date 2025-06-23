import { TestBed } from '@angular/core/testing';

import { ClipsStateService } from './clips-state.service';

describe('ClipsStateService', () => {
  let service: ClipsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClipsStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
