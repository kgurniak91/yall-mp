import { TestBed } from '@angular/core/testing';

import { ProjectActionService } from './project-action.service';

xdescribe('ProjectActionService', () => {
  let service: ProjectActionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectActionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
