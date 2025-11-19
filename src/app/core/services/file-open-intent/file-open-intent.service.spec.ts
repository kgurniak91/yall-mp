import { TestBed } from '@angular/core/testing';

import { FileOpenIntentService } from './file-open-intent.service';

xdescribe('FileOpenIntentService', () => {
  let service: FileOpenIntentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileOpenIntentService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
