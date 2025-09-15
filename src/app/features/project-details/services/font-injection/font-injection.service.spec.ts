import { TestBed } from '@angular/core/testing';

import { FontInjectionService } from './font-injection.service';

xdescribe('FontInjectionService', () => {
  let service: FontInjectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FontInjectionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
