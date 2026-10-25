import {computeFit, VideoSurfaceRenderer} from './video-surface-renderer';

const solidFrame = (width: number, height: number, [r, g, b]: [number, number, number]): VideoFrame => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return new VideoFrame(data, {format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: 0});
};

const near = (actual: number[], expected: number[], tolerance = 3): void => {
  expected.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThanOrEqual(tolerance, `channel ${i} of ${actual}`));
};

describe('computeFit', () => {
  it('fills a canvas of the same aspect ratio', () => {
    expect(computeFit({width: 1280, height: 720}, {width: 640, height: 360})).toEqual({x: 0, y: 0, width: 640, height: 360});
  });

  it('letterboxes a wide frame in a tall canvas', () => {
    expect(computeFit({width: 1600, height: 900}, {width: 800, height: 800})).toEqual({x: 0, y: 175, width: 800, height: 450});
  });

  it('pillarboxes a tall frame in a wide canvas', () => {
    expect(computeFit({width: 900, height: 1600}, {width: 1000, height: 450})).toEqual({x: 374, y: 0, width: 253, height: 450});
  });

  it('scales a stale small frame up without stretching it', () => {
    const fit = computeFit({width: 320, height: 180}, {width: 1000, height: 1000});
    expect(fit.width / fit.height).toBeCloseTo(16 / 9, 1);
    expect(fit.x).toBe(0);
  });

  it('returns an empty rect for degenerate sizes', () => {
    expect(computeFit({width: 0, height: 10}, {width: 10, height: 10}).width).toBe(0);
    expect(computeFit({width: 10, height: 10}, {width: 10, height: 0}).height).toBe(0);
  });
});

describe('VideoSurfaceRenderer', () => {
  let canvas: HTMLCanvasElement;
  let renderer: VideoSurfaceRenderer;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    document.body.appendChild(canvas);
    renderer = new VideoSurfaceRenderer(canvas);
  });

  afterEach(() => {
    renderer.dispose();
    canvas.remove();
  });

  it('picks a drawing backend', () => {
    expect(renderer.stats.backend).not.toBe('none');
  });

  it('draws the colour of the frame at the centre', () => {
    renderer.present(solidFrame(160, 90, [255, 0, 0]));
    renderer.renderNow();
    near(renderer.readPixel(80, 45), [255, 0, 0, 255]);
    expect(renderer.stats.drawn).toBe(1);
  });

  it('reports whether the probe points of the next frames are black, and then stops', () => {
    if (renderer.stats.backend !== 'webgl2') {
      pending('needs WebGL2');
    }
    const reports: boolean[] = [];
    renderer.startProbe(2, black => reports.push(black));
    renderer.present(solidFrame(160, 90, [0, 0, 0]));
    renderer.renderNow();
    renderer.present(solidFrame(160, 90, [0, 200, 0]));
    renderer.renderNow();
    renderer.present(solidFrame(160, 90, [0, 0, 0]));
    renderer.renderNow();
    expect(reports).toEqual([true, false]);
  });

  it('probes on the 2d fallback too', () => {
    const plain = document.createElement('canvas');
    plain.width = 160;
    plain.height = 90;
    document.body.appendChild(plain);
    // a canvas that already has a 2d context cannot get a WebGL one
    plain.getContext('2d');
    const fallback = new VideoSurfaceRenderer(plain);
    try {
      expect(fallback.stats.backend).toBe('2d');
      const reports: boolean[] = [];
      fallback.startProbe(2, black => reports.push(black));
      fallback.present(solidFrame(160, 90, [0, 0, 0]));
      fallback.renderNow();
      fallback.present(solidFrame(160, 90, [0, 200, 0]));
      fallback.renderNow();
      expect(reports).toEqual([true, false]);
    } finally {
      fallback.dispose();
      plain.remove();
    }
  });

  it('letterboxes a frame of another aspect ratio with opaque black', () => {
    renderer.present(solidFrame(90, 90, [0, 255, 0]));
    renderer.renderNow();
    near(renderer.readPixel(80, 45), [0, 255, 0, 255]);
    near(renderer.readPixel(5, 45), [0, 0, 0, 255]);
    near(renderer.readPixel(155, 45), [0, 0, 0, 255]);
  });

  it('draws a stale-size frame uniformly scaled after a resize', () => {
    renderer.present(solidFrame(160, 90, [0, 0, 255]));
    renderer.renderNow();
    renderer.setBackingSize(320, 320);
    // 16:9 in a square: bars above and below, picture in the middle
    near(renderer.readPixel(160, 160), [0, 0, 255, 255]);
    near(renderer.readPixel(160, 10), [0, 0, 0, 255]);
    near(renderer.readPixel(160, 310), [0, 0, 0, 255]);
  });

  it('redraws the kept frame when the size changes, without a new frame', () => {
    renderer.present(solidFrame(160, 90, [255, 0, 0]));
    renderer.renderNow();
    renderer.setBackingSize(400, 225);
    near(renderer.readPixel(200, 112), [255, 0, 0, 255]);
    expect(renderer.stats.drawn).toBe(2);
    expect(canvas.width).toBe(400);
  });

  it('keeps only the newest of the frames that arrive before a draw and closes the others', () => {
    const first = solidFrame(160, 90, [255, 0, 0]);
    const second = solidFrame(160, 90, [0, 255, 0]);
    const closeFirst = spyOn(first, 'close').and.callThrough();
    renderer.present(first);
    renderer.present(second);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(renderer.stats.dropped).toBe(1);
    renderer.renderNow();
    near(renderer.readPixel(80, 45), [0, 255, 0, 255]);
  });

  it('closes the previous frame once a new one was drawn', () => {
    const first = solidFrame(160, 90, [255, 0, 0]);
    const closeFirst = spyOn(first, 'close').and.callThrough();
    renderer.present(first);
    renderer.renderNow();
    expect(closeFirst).not.toHaveBeenCalled();
    renderer.present(solidFrame(160, 90, [0, 255, 0]));
    renderer.renderNow();
    expect(closeFirst).toHaveBeenCalledTimes(1);
  });

  it('draws on an animation frame without being asked', async () => {
    renderer.present(solidFrame(160, 90, [255, 0, 0]));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(renderer.stats.drawn).toBe(1);
  });

  it('closes pending and kept frames on dispose and ignores later frames', () => {
    const kept = solidFrame(160, 90, [255, 0, 0]);
    const pending = solidFrame(160, 90, [0, 255, 0]);
    const late = solidFrame(160, 90, [0, 0, 255]);
    const closeKept = spyOn(kept, 'close').and.callThrough();
    const closePending = spyOn(pending, 'close').and.callThrough();
    const closeLate = spyOn(late, 'close').and.callThrough();
    renderer.present(kept);
    renderer.renderNow();
    renderer.present(pending);
    renderer.dispose();
    expect(closeKept).toHaveBeenCalledTimes(1);
    expect(closePending).toHaveBeenCalledTimes(1);
    renderer.present(late);
    expect(closeLate).toHaveBeenCalledTimes(1);
  });

  it('exposes its stats for probes and removes them on dispose', () => {
    expect((window as unknown as { __yallVideoStats?: unknown }).__yallVideoStats).toBe(renderer.stats);
    renderer.dispose();
    expect((window as unknown as { __yallVideoStats?: unknown }).__yallVideoStats).toBeUndefined();
  });

  it('recovers from a lost WebGL context', async () => {
    if (renderer.stats.backend !== 'webgl2') {
      pending('WebGL2 is not available here');
    }
    const lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
    if (!lose) {
      pending('WEBGL_lose_context is not available here');
    }
    renderer.present(solidFrame(160, 90, [255, 0, 0]));
    renderer.renderNow();

    lose!.loseContext();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(renderer.stats.contextLosses).toBe(1);
    // frames that arrive while the context is gone are kept, not drawn
    renderer.present(solidFrame(160, 90, [0, 255, 0]));
    renderer.renderNow();

    // registered after the renderer's own listener, so it runs once the picture was redrawn, in the same task
    const restoredPixel = new Promise<number[]>(resolve =>
      canvas.addEventListener('webglcontextrestored', () => resolve(renderer.readPixel(80, 45)), {once: true}));
    lose!.restoreContext();
    near(await restoredPixel, [0, 255, 0, 255]);
  });
});
