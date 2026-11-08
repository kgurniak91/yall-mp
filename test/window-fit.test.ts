import {describe, expect, it} from 'vitest';
import {MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, windowFitSize} from '../window-fit';

describe('windowFitSize', () => {
  it('leaves a window that fits alone', () => {
    expect(windowFitSize({width: 1200, height: 700}, {width: 1920, height: 1080})).toBeNull();
    expect(windowFitSize({width: 640, height: 480}, {width: 640, height: 480})).toBeNull();
  });

  it('shrinks a window that is larger than the display', () => {
    expect(windowFitSize({width: 2494, height: 1408}, {width: 1920, height: 1080})).toEqual({
      width: 1920, height: 1080, minWidth: MIN_WINDOW_WIDTH, minHeight: MIN_WINDOW_HEIGHT
    });
  });

  it('shrinks one side only when only that side does not fit', () => {
    expect(windowFitSize({width: 1200, height: 1408}, {width: 1920, height: 1080})).toMatchObject({width: 1200, height: 1080});
  });

  it('lowers the minimum below the display on a very small screen', () => {
    const fit = windowFitSize({width: 1000, height: 700}, {width: 640, height: 448})!;
    expect(fit).toEqual({width: 640, height: 448, minWidth: 640, minHeight: 448});
  });

  it('ignores reports that cannot be a display', () => {
    expect(windowFitSize({width: 1000, height: 700}, {width: 0, height: 0})).toBeNull();
    expect(windowFitSize({width: 1000, height: 700}, {width: NaN, height: 480})).toBeNull();
  });
});
