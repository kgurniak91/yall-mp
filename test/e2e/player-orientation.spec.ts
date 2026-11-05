import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {captureComposited, canvasMatchesContainer, capturePage, pictureRect, type Rgb} from './support/capture';
import {CLIPS, inClip} from './support/clips';
import {expectVideoShowsClip, launchClips, pixelProbesAvailable, probeVideoColor} from './support/player';

// The picture is the right way round on the real screen: clips.mp4 has a moving testsrc2 inset (64x36 at 8,8 of the
// 320x180 picture) in the TOP-LEFT corner on a solid clip colour, so a vertical or horizontal flip, or a wrong
// colour order, moves the inset to another corner or changes the colour. Checked in the window, after a resize and in
// fullscreen, on the page capture (the composited page: canvas and DOM) at the four corners and the centre, and on the
// composited screen capture (what the user sees) at the top-left corner. The screen capture is kept as evidence; it is
// not used for the other corners because an OS dialog may sit on top of the window (macOS consent and "quit
// unexpectedly" alerts on an unattended test Mac).
test.skip(!pixelProbesAvailable, 'pixel probes need a real GPU and screen');

type App = Parameters<typeof captureComposited>[0];

const CLIP = 7; // a long clip, solid #ff8000
const INSET = {x0: 8 / 320, x1: 72 / 320, y0: 8 / 180, y1: 44 / 180};

const toRgb = (hex: string): Rgb => ({r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16)});
const distance = (a: Rgb | null, b: Rgb): number => a ? Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) : Infinity;

/** A 5x5 grid over the inset area, mirrored into the corner given by `flipX` / `flipY`, as fractions of the picture. */
const insetGrid = (flipX: boolean, flipY: boolean): { fx: number; fy: number }[] => {
  const points = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const fx = INSET.x0 + (INSET.x1 - INSET.x0) * (0.1 + 0.8 * i / 4);
      const fy = INSET.y0 + (INSET.y1 - INSET.y0) * (0.1 + 0.8 * j / 4);
      points.push({fx: flipX ? 1 - fx : fx, fy: flipY ? 1 - fy : fy});
    }
  }
  return points;
};

interface Reading {
  /** The centre of the picture, from the page capture */
  centre: Rgb | null;
  /** Share of the grid points that are NOT the clip colour, per corner (page capture): the inset belongs in topLeft only, the other three are the clip colour */
  notSolid: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  /** The same share for the top-left corner on the composited screen */
  screenTopLeft: number;
}

async function read(app: App, ui: Parameters<typeof pictureRect>[0], label: string): Promise<Reading> {
  const solid = toRgb(CLIPS[CLIP].color);
  const rect = await pictureRect(ui, 320 / 180);
  const content = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().mainWindow.getContentBounds());
  const notSolidShare = (colors: (Rgb | null)[]): number => colors.filter(c => distance(c, solid) > 60).length / colors.length;
  const corners = {topLeft: insetGrid(false, false), topRight: insetGrid(true, false), bottomLeft: insetGrid(false, true), bottomRight: insetGrid(true, true)};
  const names = Object.keys(corners) as (keyof typeof corners)[];

  const page = await capturePage(app, ui);
  const notSolid = {} as Reading['notSolid'];
  for (const n of names) {
    notSolid[n] = notSolidShare(corners[n].map(p => page.colorAt(rect.x + rect.width * p.fx, rect.y + rect.height * p.fy)));
  }

  const screenAt = (fx: number, fy: number) => ({x: content.x + rect.x + rect.width * fx, y: content.y + rect.y + rect.height * fy});
  const {png, colors} = await captureComposited(app, corners.topLeft.map(p => screenAt(p.fx, p.fy)));
  await test.info().attach(`orientation-${label}.png`, {body: png, contentType: 'image/png'});
  const dir = process.env['YALL_E2E_ORIENTATION_DIR'];
  if (dir) {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, `${process.env['YALL_MP_VIDEO_BACKEND'] ?? 'default'}-${label}.png`), png);
  }
  const reading = {centre: await probeVideoColor(app, ui), notSolid, screenTopLeft: notSolidShare(colors)};
  test.info().annotations.push({type: `orientation ${label}`, description: JSON.stringify(reading)});
  return reading;
}

async function expectUpright(app: App, ui: Parameters<typeof pictureRect>[0], label: string): Promise<void> {
  let last: Reading | null = null;
  const solid = toRgb(CLIPS[CLIP].color);
  try {
    await expect.poll(async () => {
      if (!(await canvasMatchesContainer(ui)).ok) {
        return false;
      }
      last = await read(app, ui, label);
      const n = last.notSolid;
      return distance(last.centre, solid) < 60 && n.topLeft >= 0.5 && n.topRight <= 0.1 && n.bottomLeft <= 0.1 && n.bottomRight <= 0.1 &&
        last.screenTopLeft >= 0.5;
    }, {timeout: 10_000}).toBe(true);
  } catch (e) {
    throw new Error(`${label}: the inset should be top-left on the ${CLIPS[CLIP].color} clip colour, last reading ${JSON.stringify(last)}\n${(e as Error).message}`);
  }
}

test('the picture is upright and in the right colours, in the window, after a resize and in fullscreen', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(CLIP, 0.5)});
  await expectVideoShowsClip(app, ui, CLIP);
  await expectUpright(app, ui, 'window');

  await app.evaluate(() => {
    const win = (globalThis as any).__yallE2E.getWindows().mainWindow;
    const b = win.getBounds();
    win.setBounds({x: b.x, y: b.y, width: 1000, height: 700});
  });
  await expectUpright(app, ui, 'resized');

  const fullScreen = () => app.evaluate(() => (globalThis as any).__yallE2E.getWindows().mainWindow.isFullScreen());
  await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
  await expect.poll(fullScreen, {timeout: 10_000}).toBe(true);
  await expectUpright(app, ui, 'fullscreen');
  await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
  await expect.poll(fullScreen, {timeout: 10_000}).toBe(false);
});
