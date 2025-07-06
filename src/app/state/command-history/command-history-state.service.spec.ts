import { TestBed } from '@angular/core/testing';

import { CommandHistoryStateService } from './command-history-state.service';

describe('CommandHistoryStateService', () => {
  let service: CommandHistoryStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CommandHistoryStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
