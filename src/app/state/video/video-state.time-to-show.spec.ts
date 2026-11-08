import {PlayerState} from '../../model/video.types';
import {timeToShow} from './video-state.service';

describe('timeToShow', () => {
  it('shows the duration when the file has ended, even if the last time update was the last frame', () => {
    expect(timeToShow({playerState: PlayerState.Ended, currentTime: 89.9667}, 90)).toBe(90);
    expect(timeToShow({playerState: PlayerState.Ended, currentTime: 90}, 90)).toBe(90);
  });

  it('shows the reported time in every other state', () => {
    expect(timeToShow({playerState: PlayerState.Playing, currentTime: 89.9667}, 90)).toBe(89.9667);
    expect(timeToShow({playerState: PlayerState.PausedByUser, currentTime: 12.5}, 90)).toBe(12.5);
  });

  it('keeps the reported time while the duration is not known yet', () => {
    expect(timeToShow({playerState: PlayerState.Ended, currentTime: 4}, 0)).toBe(4);
  });
});
