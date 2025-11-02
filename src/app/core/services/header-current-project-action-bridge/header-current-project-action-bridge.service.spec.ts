import { TestBed } from '@angular/core/testing';

import { HeaderCurrentProjectActionBridgeService } from './header-current-project-action-bridge.service';

xdescribe('HeaderCurrentProjectActionBridgeService', () => {
  let service: HeaderCurrentProjectActionBridgeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HeaderCurrentProjectActionBridgeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
