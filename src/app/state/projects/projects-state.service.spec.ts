import { TestBed } from '@angular/core/testing';

import { ProjectsStateService } from './projects-state.service';

describe('ProjectsStateService', () => {
  let service: ProjectsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectsStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
