import { TestBed } from '@angular/core/testing';

import { DialogOrchestrationService } from './dialog-orchestration.service';

xdescribe('DialogOrchestrationService', () => {
  let service: DialogOrchestrationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DialogOrchestrationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
