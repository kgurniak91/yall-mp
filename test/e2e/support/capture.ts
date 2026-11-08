import type {ElectronApplication} from '@playwright/test';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Composited screen capture of the main window area. Today mpv draws into a separate native window, so
 * page.screenshot() cannot see the video; only a capture of the real screen does.
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
