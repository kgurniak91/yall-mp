import { TestBed } from '@angular/core/testing';

import { AssStyleService } from './ass-style.service';

describe('AssStyleService', () => {
  let service: AssStyleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AssStyleService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
