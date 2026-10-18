import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {getWindowStates} from './support/windows';
import {dragMouse} from './support/os-input-win';

// @os-input: moves the REAL mouse. Keep hands off the machine while it runs.
test.skip(process.platform !== 'win32', 'Windows-only real input');
test.describe('@os-input', () => {
  const toPhysical = (app: ElectronApplication, p: { x: number; y: number }) =>
    app.evaluate(({screen}, pt) => screen.dipToScreenPoint(pt), p);

  async function handleCentre(app: ElectronApplication, ui: Page) {
    const {ui: uiWin} = (await getWindowStates(app));
    const r = (await ui.locator('.drag-handle').boundingBox())!;
    return {x: uiWin!.contentBounds.x + r.x + r.width / 2, y: uiWin!.contentBounds.y + r.y + r.height / 2};
  }

  async function drag(app: ElectronApplication, from: { x: number; y: number }, to: { x: number; y: number }) {
    dragMouse(await toPhysical(app, from), await toPhysical(app, to));
  }

  test('drag the header, snap to the left edge, drag back to restore', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    // Normalise to a known, un-snapped position
    const start = (await getWindowStates(app)).main!;
    const work = start.display.workArea;
    await app.evaluate((_e, w) => {
      (globalThis as any).__yallE2E.getWindows().mainWindow.setBounds({x: w.x + 200, y: w.y + 100, width: 1000, height: 700});
    }, work);
    await expect.poll(async () => Math.abs((await getWindowStates(app)).main!.bounds.x - (work.x + 200))).toBeLessThanOrEqual(2);
    const before = (await getWindowStates(app)).main!.bounds;

    // 1. Plain drag
    const h1 = await handleCentre(app, ui);
    await drag(app, h1, {x: h1.x + 150, y: h1.y + 80});
    await expect.poll(async () => {
      const b = (await getWindowStates(app)).main!.bounds;
      return Math.abs(b.x - (before.x + 150)) <= 8 && Math.abs(b.y - (before.y + 80)) <= 8;
    }, {timeout: 10_000}).toBe(true);

    // 2. Aero Snap to the left half
    const h2 = await handleCentre(app, ui);
    await drag(app, h2, {x: work.x, y: work.y + work.height / 2});
    await expect.poll(async () => {
      const {main, ui: uiWin} = await getWindowStates(app);
      const m = main!.bounds;
      const half = {x: work.x, y: work.y, width: work.width / 2, height: work.height};
      return Math.abs(m.x - half.x) <= 16 && Math.abs(m.width - half.width) <= 16 && Math.abs(m.height - half.height) <= 16 &&
        Math.abs(uiWin!.bounds.width - m.width) <= 2;
    }, {timeout: 10_000}).toBe(true);

    // Snap Assist may be showing: click inside the header (not Escape, which would minimize the app)
    const h3 = await handleCentre(app, ui);
    dragMouse(await toPhysical(app, h3), await toPhysical(app, h3));

    // 3. Drag from the snapped state back to the middle: width returns to the pre-snap width
    await drag(app, h3, {x: work.x + work.width / 2, y: work.y + 200});
    await expect.poll(async () => Math.abs((await getWindowStates(app)).main!.bounds.width - before.width), {timeout: 10_000}).toBeLessThanOrEqual(16);
  });
});
