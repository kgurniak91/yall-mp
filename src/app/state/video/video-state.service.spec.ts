import { TestBed } from '@angular/core/testing';

import { VideoStateService } from './video-state.service';

xdescribe('VideoStateService', () => {
  let service: VideoStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VideoStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
