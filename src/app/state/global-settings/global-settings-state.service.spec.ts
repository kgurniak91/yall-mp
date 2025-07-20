import { TestBed } from '@angular/core/testing';

import { GlobalSettingsStateService } from './global-settings-state.service';

describe('GlobalSettingsStateService', () => {
  let service: GlobalSettingsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GlobalSettingsStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
