import type {ElectronApplication, Page} from '@playwright/test';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Composited screen capture of the main window area (the real screen, so it also shows what the OS puts above
 * the page). For the page content alone `capturePage` is enough now that the video is a canvas in the page.
 * `probes` are points in DIP screen coordinates whose colours are read from the capture.
 */
export async function captureComposited(
  app: ElectronApplication,
  probes: { x: number; y: number }[] = []
): Promise<{ png: Buffer; colors: (Rgb | null)[] }> {
  const result = await app.evaluate(async ({desktopCapturer, screen}, points) => {
    const win = (globalThis as any).__yallE2E.getWindows().mainWindow;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale)}
    });
    const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0];
    if (!source) {
      throw new Error('No screen source available for capture');
    }

    const crop = {
      x: Math.max(0, Math.round((bounds.x - display.bounds.x) * scale)),
      y: Math.max(0, Math.round((bounds.y - display.bounds.y) * scale)),
      width: Math.round(bounds.width * scale),
      height: Math.round(bounds.height * scale)
    };
    const full = source.thumbnail;
    const size = full.getSize();
    crop.width = Math.min(crop.width, size.width - crop.x);
    crop.height = Math.min(crop.height, size.height - crop.y);
    const cropped = full.crop(crop);
    const bitmap = cropped.toBitmap(); // BGRA
    const stride = crop.width * 4;

    const colors = (points as { x: number; y: number }[]).map(p => {
      const px = Math.round((p.x - bounds.x) * scale);
      const py = Math.round((p.y - bounds.y) * scale);
      if (px < 0 || py < 0 || px >= crop.width || py >= crop.height) {
        return null;
      }
      const o = py * stride + px * 4;
      return {r: bitmap[o + 2], g: bitmap[o + 1], b: bitmap[o]};
    });

    return {png: cropped.toPNG().toString('base64'), colors};
  }, probes);

  return {png: Buffer.from(result.png, 'base64'), colors: result.colors};
}

export const isRed = (c: Rgb | null): boolean => !!c && c.r > 180 && c.g < 80 && c.b < 80;
export const isGreen = (c: Rgb | null): boolean => !!c && c.g > 120 && c.r < 80 && c.b < 80;

export interface PageCapture {
  png: Buffer;
  /** Pixels in the capture per CSS pixel (device pixel ratio). */
  scale: number;
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  rgba: Buffer;
  /** Colour at a point in CSS pixels, or null outside the capture. */
  colorAt(x: number, y: number): Rgb | null;
  /** Number of near-white pixels in a CSS pixel rectangle (rendered subtitle text). */
  countWhite(rect: { x: number; y: number; width: number; height: number }): number;
}

/** Screenshot of the page with the video in it, decoded in the main process (nativeImage, no extra dependency). */
export async function capturePage(app: ElectronApplication, ui: Page): Promise<PageCapture> {
  const png = await ui.screenshot();
  const viewportWidth = await ui.evaluate(() => window.innerWidth);
  const decoded = await app.evaluate(({nativeImage}, base64) => {
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
    const size = image.getSize();
    return {width: size.width, height: size.height, bgra: image.toBitmap().toString('base64')};
  }, png.toString('base64'));
  const bgra = Buffer.from(decoded.bgra, 'base64');
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  const scale = decoded.width / viewportWidth;
  const at = (x: number, y: number): Rgb | null => {
    const px = Math.round(x * scale);
    const py = Math.round(y * scale);
    if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) {
      return null;
    }
    const o = (py * decoded.width + px) * 4;
    return {r: rgba[o], g: rgba[o + 1], b: rgba[o + 2]};
  };
  return {
    png, scale, width: decoded.width, height: decoded.height, rgba, colorAt: at,
    countWhite: rect => {
      let count = 0;
      const x0 = Math.max(0, Math.round(rect.x * scale));
      const y0 = Math.max(0, Math.round(rect.y * scale));
      const x1 = Math.min(decoded.width, Math.round((rect.x + rect.width) * scale));
      const y1 = Math.min(decoded.height, Math.round((rect.y + rect.height) * scale));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * decoded.width + x) * 4;
          if (rgba[o] > 235 && rgba[o + 1] > 235 && rgba[o + 2] > 235) {
            count++;
          }
        }
      }
      return count;
    }
  };
}

export const isBlack = (c: Rgb | null): boolean => !!c && c.r < 12 && c.g < 12 && c.b < 12;
export const isBlue = (c: Rgb | null): boolean => !!c && c.b > 120 && c.r < 80 && c.g < 80;

/** The part of `#video-container` the picture occupies, in CSS pixels, for a video of the given aspect ratio. */
export async function pictureRect(ui: Page, aspect = 16 / 9): Promise<{ x: number; y: number; width: number; height: number; container: { x: number; y: number; width: number; height: number } }> {
  const box = (await ui.locator('#video-container').boundingBox())!;
  let width = box.width;
  let height = width / aspect;
  if (height > box.height) {
    height = box.height;
    width = height * aspect;
  }
  return {x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height, container: box};
}
