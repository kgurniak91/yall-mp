import { TestBed } from '@angular/core/testing';

import { ProjectSettingsStateService } from './project-settings-state.service';

describe('ProjectSettingsStateService', () => {
  let service: ProjectSettingsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectSettingsStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
