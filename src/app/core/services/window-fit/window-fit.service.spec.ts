import {exceedsDisplay} from './window-fit.service';

describe('exceedsDisplay', () => {
  it('is false for a window that fits', () => {
    expect(exceedsDisplay({width: 1200, height: 700}, {width: 1920, height: 1080})).toBeFalse();
    expect(exceedsDisplay({width: 1920, height: 1080}, {width: 1920, height: 1080})).toBeFalse();
    expect(exceedsDisplay({width: 1921, height: 1080}, {width: 1920, height: 1080})).toBeFalse();
  });

  it('is true when either side is larger than the display', () => {
    expect(exceedsDisplay({width: 2494, height: 1408}, {width: 1920, height: 1080})).toBeTrue();
    expect(exceedsDisplay({width: 1200, height: 1100}, {width: 1920, height: 1080})).toBeTrue();
  });

  it('ignores a display without a size', () => {
    expect(exceedsDisplay({width: 1200, height: 700}, {width: 0, height: 0})).toBeFalse();
  });
});
