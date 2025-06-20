import { TestBed } from '@angular/core/testing';

import { ClipPlayerService } from './clip-player.service';

describe('ClipPlayerService', () => {
  let service: ClipPlayerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClipPlayerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
