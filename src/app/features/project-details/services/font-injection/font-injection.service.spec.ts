import { TestBed } from '@angular/core/testing';

import { FontInjectionService } from './font-injection.service';

describe('FontInjectionService', () => {
  let service: FontInjectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FontInjectionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
