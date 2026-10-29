import * as fs from 'fs';
import * as path from 'path';
import {expect, test, type LaunchedApp, type LaunchOptions} from './support/app';
import {capturePage, pictureRect, type Rgb} from './support/capture';
import {ensureHdrClips, PATCH_COLUMNS, PATCH_ROWS, PATCHES} from './support/hdr-media';
import {launchClips, pixelProbesAvailable, seekTo, waitForTime} from './support/player';

// A HDR10 (PQ, BT.2020) clip has to come out of the player like the same picture as SDR: tone-mapped for an SDR
// screen, not washed out and not clipped. Reads pixels, so it needs a real GPU and screen.
test.skip(!pixelProbesAvailable, 'pixel probes need a real GPU and screen');

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

const distance = (a: Rgb, b: readonly [number, number, number]): number => Math.max(Math.abs(a.r - b[0]), Math.abs(a.g - b[1]), Math.abs(a.b - b[2]));

async function patchColours(launch: (opts?: LaunchOptions) => Promise<LaunchedApp>, media: string) {
  const {app, ui, userDataDir} = await launchClips(launch, {media, duration: 3, lastPlaybackTime: 1});
  await seekTo(ui, 1);
  await waitForTime(ui, time => Math.abs(time - 1) < 0.3, 'the paused picture is at 1 s');
  const rect = await pictureRect(ui, 16 / 9);
  let colours: Rgb[] = [];
  // The picture may need a moment after the seek; wait until all patches are lit
  await expect.poll(async () => {
    const shot = await capturePage(app, ui);
    colours = PATCHES.map((_, index) => {
      const column = index % PATCH_COLUMNS;
      const row = Math.floor(index / PATCH_COLUMNS);
      return shot.colorAt(rect.x + rect.width * (column + 0.5) / PATCH_COLUMNS, rect.y + rect.height * (row + 0.5) / PATCH_ROWS)!;
    });
    return colours.every(Boolean) && colours[0].r > 100;
  }, {timeout: 15_000}).toBe(true);
  return {colours, log: videoLog(userDataDir)};
}

test('an HDR10 clip is tone-mapped to look like the same picture in SDR', async ({launch}) => {
  const clips = ensureHdrClips();
  const sdr = await patchColours(launch, clips.sdr);
  const hdr = await patchColours(launch, clips.hdr);

  const report = PATCHES.map((nominal, i) =>
    `${JSON.stringify(nominal)} sdr=${JSON.stringify(sdr.colours[i])} hdr=${JSON.stringify(hdr.colours[i])}`).join('\n');
  test.info().annotations.push({type: 'patches', description: report});
  test.info().annotations.push({type: 'colour log', description: `${sdr.log.split('\n').filter(l => l.includes('Video colour')).join(' | ')}\n${hdr.log.split('\n').filter(l => l.includes('Video colour')).join(' | ')}`});

  // The SDR clip is the reference: its patches are the nominal colours, up to the lossy encode
  PATCHES.forEach((nominal, i) => expect(distance(sdr.colours[i], nominal), `SDR patch ${i}\n${report}`).toBeLessThanOrEqual(16));

  // A clip with mastering metadata (1000 nit title) comes out within a few levels of the SDR picture
  PATCHES.forEach((_, i) => expect(distance(hdr.colours[i], [sdr.colours[i].r, sdr.colours[i].g, sdr.colours[i].b]), `HDR patch ${i} vs SDR\n${report}`).toBeLessThanOrEqual(30));

  // Whatever the mapping does, the structure must stay: grey (lifted blacks), clipped or desaturated pictures are what a
  // broken mapping looks like.
  const [white, grey, dark, black, red, green, blue, yellow] = hdr.colours;
  const luma = (c: Rgb): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const why = `\n${report}`;
  expect(luma(black), `black stays black${why}`).toBeLessThanOrEqual(12);
  expect(luma(white), `white is bright${why}`).toBeGreaterThanOrEqual(150);
  expect(luma(white), `white is not clipped far above SDR${why}`).toBeLessThanOrEqual(255);
  expect(luma(white) > luma(grey) && luma(grey) > luma(dark) && luma(dark) >= luma(black), `brightness order${why}`).toBe(true);
  expect(luma(grey), `mid grey is not lifted${why}`).toBeLessThanOrEqual(sdr.colours[1].r + 10);
  expect(red.r >= 100 && red.g <= 40 && red.b <= 40, `red stays saturated${why}`).toBe(true);
  expect(green.g >= 80 && green.r <= 40 && green.b <= 40, `green stays saturated${why}`).toBe(true);
  expect(blue.b >= 100 && blue.r <= 50 && blue.g <= 80, `blue stays saturated${why}`).toBe(true);
  expect(yellow.r >= 80 && yellow.g >= 80 && yellow.b <= 60, `yellow stays yellow${why}`).toBe(true);

  // The log says what mpv saw and handed on
  expect(hdr.log).toMatch(/Video colour: in\([^)]*gamma=pq[^)]*\)/);
  expect(sdr.log).toMatch(/Video colour: in\([^)]*\)/);
});
