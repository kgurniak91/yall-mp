import { TestBed } from '@angular/core/testing';

import { SubtitlesHighlighterService } from './subtitles-highlighter.service';

xdescribe('SubtitlesHighlighterService', () => {
  let service: SubtitlesHighlighterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SubtitlesHighlighterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
