import {describe, expect, it} from 'vitest';
import {boundsInsideWorkArea, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, windowFitSize} from '../window-fit';

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

describe('boundsInsideWorkArea', () => {
  const workArea = {x: 2560, y: 0, width: 1920, height: 1080};

  it('leaves a window that fits alone, even when it sticks out', () => {
    expect(boundsInsideWorkArea({x: 2600, y: 40, width: 1200, height: 700}, workArea)).toBeNull();
    expect(boundsInsideWorkArea({x: 4000, y: 40, width: 1200, height: 700}, workArea)).toBeNull();
  });

  it('shrinks a larger window to the work area and moves it inside', () => {
    expect(boundsInsideWorkArea({x: 2807, y: 154, width: 2200, height: 1200}, workArea))
      .toEqual({x: 2560, y: 0, width: 1920, height: 1080});
  });

  it('shrinks one side and keeps the other position when it is already inside', () => {
    expect(boundsInsideWorkArea({x: 2700, y: 20, width: 1000, height: 1400}, workArea))
      .toEqual({x: 2700, y: 0, width: 1000, height: 1080});
  });

  it('ignores a work area that cannot be real', () => {
    expect(boundsInsideWorkArea({x: 0, y: 0, width: 1000, height: 700}, {x: 0, y: 0, width: 0, height: 0})).toBeNull();
  });
});
