import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {getWindowStates} from './support/windows';
import {doubleClickMouse, dragMouse} from './support/os-input-win';
import {launchClips, VIDEO_AREA} from './support/player';
import {CLIPS, CLIPS_ASS} from './support/clips';

// @os-input: moves the REAL mouse. Keep hands off the machine while it runs.
test.skip(process.platform !== 'win32', 'Windows-only real input');
test.describe('@os-input', () => {
  type Point = { x: number; y: number };

  const toPhysical = (app: ElectronApplication, p: Point) =>
    app.evaluate(({screen}, pt) => screen.dipToScreenPoint(pt), p);

  const mainState = async (app: ElectronApplication) => (await getWindowStates(app)).main!;

  /** Centre of an element in screen DIPs. */
  async function centreOf(app: ElectronApplication, ui: Page, selector: string): Promise<Point> {
    const content = (await mainState(app)).contentBounds;
    const r = (await ui.locator(selector).boundingBox())!;
    return {x: content.x + r.x + r.width / 2, y: content.y + r.y + r.height / 2};
  }

  const handleCentre = (app: ElectronApplication, ui: Page) => centreOf(app, ui, '.drag-handle');

  /** A point in the empty header space between the last filename and the drag handle. */
  async function filenameGap(app: ElectronApplication, ui: Page): Promise<Point> {
    const content = (await mainState(app)).contentBounds;
    const last = (await ui.locator('.filename').last().boundingBox())!;
    const handle = (await ui.locator('.drag-handle').boundingBox())!;
    return {x: content.x + (last.x + last.width + handle.x) / 2, y: content.y + handle.y + handle.height / 2};
  }

  async function drag(app: ElectronApplication, from: Point, to: Point) {
    dragMouse(await toPhysical(app, from), await toPhysical(app, to));
  }

  async function setBounds(app: ElectronApplication, bounds: { x: number; y: number; width: number; height: number }) {
    await app.evaluate((_e, b) => {
      (globalThis as any).__yallE2E.getWindows().mainWindow.setBounds(b);
    }, bounds);
    await expect.poll(async () => {
      const b = (await mainState(app)).bounds;
      return Math.abs(b.x - bounds.x) <= 2 && Math.abs(b.width - bounds.width) <= 2;
    }).toBe(true);
  }

  test('drag the header, snap to the left edge, drag back to restore', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    // Normalise to a known, un-snapped position
    const work = (await mainState(app)).display.workArea;
    await setBounds(app, {x: work.x + 200, y: work.y + 100, width: 1000, height: 700});
    const before = (await mainState(app)).bounds;

    // 1. Plain drag by the handle
    const h1 = await handleCentre(app, ui);
    await drag(app, h1, {x: h1.x + 150, y: h1.y + 80});
    await expect.poll(async () => {
      const b = (await mainState(app)).bounds;
      return Math.abs(b.x - (before.x + 150)) <= 8 && Math.abs(b.y - (before.y + 80)) <= 8;
    }, {timeout: 10_000}).toBe(true);

    // 2. Aero Snap to the left half
    const h2 = await handleCentre(app, ui);
    await drag(app, h2, {x: work.x, y: work.y + work.height / 2});
    await expect.poll(async () => {
      const m = (await mainState(app)).bounds;
      return Math.abs(m.x - work.x) <= 16 && Math.abs(m.width - work.width / 2) <= 16 && Math.abs(m.height - work.height) <= 16;
    }, {timeout: 10_000}).toBe(true);

    // Snap Assist may be showing: click inside the header (not Escape, which would minimize the app)
    const h3 = await handleCentre(app, ui);
    dragMouse(await toPhysical(app, h3), await toPhysical(app, h3));

    // 3. Drag from the snapped state back to the middle: width returns to the pre-snap width
    await drag(app, h3, {x: work.x + work.width / 2, y: work.y + 200});
    await expect.poll(async () => Math.abs((await mainState(app)).bounds.width - before.width), {timeout: 10_000}).toBeLessThanOrEqual(16);
  });

  test('drag from the gap after the filenames', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    const work = (await mainState(app)).display.workArea;
    await setBounds(app, {x: work.x + 200, y: work.y + 100, width: 1000, height: 700});
    const before = (await mainState(app)).bounds;

    const gap = await filenameGap(app, ui);
    await drag(app, gap, {x: gap.x + 120, y: gap.y + 60});
    await expect.poll(async () => {
      const b = (await mainState(app)).bounds;
      return Math.abs(b.x - (before.x + 120)) <= 8 && Math.abs(b.y - (before.y + 60)) <= 8;
    }, {timeout: 10_000}).toBe(true);
  });

  test('drag to the top edge maximizes, drag down restores', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    const work = (await mainState(app)).display.workArea;
    await setBounds(app, {x: work.x + 200, y: work.y + 100, width: 1000, height: 700});
    const before = (await mainState(app)).bounds;

    const handle = await handleCentre(app, ui);
    await drag(app, handle, {x: handle.x, y: work.y});
    await expect.poll(async () => (await mainState(app)).isMaximized, {timeout: 10_000}).toBe(true);
    const maximized = await mainState(app);
    expect(Math.abs(maximized.bounds.width - work.width)).toBeLessThanOrEqual(16);
    expect(Math.abs(maximized.bounds.height - work.height)).toBeLessThanOrEqual(16);

    const again = await handleCentre(app, ui);
    await drag(app, again, {x: again.x, y: again.y + 300});
    await expect.poll(async () => (await mainState(app)).isMaximized, {timeout: 10_000}).toBe(false);
    expect(Math.abs((await mainState(app)).bounds.width - before.width)).toBeLessThanOrEqual(16);
  });

  test('double-clicking the drag handle maximizes the window', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    doubleClickMouse(await toPhysical(app, await handleCentre(app, ui)));
    await expect.poll(async () => (await mainState(app)).isMaximized, {timeout: 10_000}).toBe(true);
  });

  test('dragging the right and the left edge resizes the window', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    const work = (await mainState(app)).display.workArea;
    await setBounds(app, {x: work.x + 300, y: work.y + 100, width: 1000, height: 700});
    const start = (await mainState(app)).bounds;
    const midY = start.y + start.height / 2;
    // The native resize zone of a frameless window is the invisible border just outside the client area

    await drag(app, {x: start.x + start.width + 1, y: midY}, {x: start.x + start.width + 101, y: midY});
    await expect.poll(async () => (await mainState(app)).bounds.width, {timeout: 10_000}).toBeGreaterThanOrEqual(start.width + 80);
    const afterRight = (await mainState(app)).bounds;
    expect(Math.abs(afterRight.x - start.x)).toBeLessThanOrEqual(2);

    await drag(app, {x: afterRight.x - 1, y: midY}, {x: afterRight.x - 101, y: midY});
    await expect.poll(async () => (await mainState(app)).bounds.width, {timeout: 10_000}).toBeGreaterThanOrEqual(afterRight.width + 80);
    const afterLeft = (await mainState(app)).bounds;
    // The left edge moved, the right edge stayed
    expect(afterLeft.x).toBeLessThanOrEqual(afterRight.x - 80);
    expect(Math.abs((afterLeft.x + afterLeft.width) - (afterRight.x + afterRight.width))).toBeLessThanOrEqual(4);
  });

  test('ASS subtitles follow the video area after the bottom edge is dragged', async ({launch}) => {
    const {app, ui} = await launchClips(launch, {subtitle: CLIPS_ASS, lastPlaybackTime: CLIPS[3].start + 0.05});
    await waitForPlayer(ui);
    const work = (await mainState(app)).display.workArea;
    await setBounds(app, {x: work.x + 300, y: work.y + 50, width: 1000, height: 700});

    // The ASS scale tracks the height of the video area (the area stays wider than 16:9 here, so assjs scales by height), so both must change together
    const measure = () => ui.evaluate(sel => {
      const box = document.querySelector('.ASS-box');
      return {
        scale: box ? parseFloat(getComputedStyle(box).getPropertyValue('--ass-scale')) : NaN,
        height: document.querySelector(sel)!.getBoundingClientRect().height
      };
    }, VIDEO_AREA);
    await expect.poll(async () => (await measure()).scale, {timeout: 10_000}).toBeGreaterThan(0);
    const before = await measure();

    const start = (await mainState(app)).bounds;
    const midX = start.x + start.width / 2;
    await drag(app, {x: midX, y: start.y + start.height + 1}, {x: midX, y: start.y + start.height + 31});
    await expect.poll(async () => (await mainState(app)).bounds.height, {timeout: 10_000}).toBeGreaterThanOrEqual(start.height + 20);

    await expect.poll(async () => {
      const after = await measure();
      return Math.abs(after.scale / before.scale - after.height / before.height);
    }, {timeout: 5_000, message: 'the ASS scale matches the new video area height'}).toBeLessThan(0.03);
  });
});
