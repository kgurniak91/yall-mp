import { TestBed } from '@angular/core/testing';

import { SubtitlesLookupStateService } from './subtitles-lookup-state.service';

xdescribe('SubtitlesLookupStateService', () => {
  let service: SubtitlesLookupStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SubtitlesLookupStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
