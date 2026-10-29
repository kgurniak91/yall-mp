import type {ElectronApplication} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {canvasMatchesContainer, expectPictureFillsContainer} from './support/capture';
import {getWindowStates, rectsClose, restoreIfMaximized, withWindows, type Rect} from './support/windows';

interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

const displays = (app: ElectronApplication): Promise<DisplayInfo[]> =>
  app.evaluate(({screen}) => screen.getAllDisplays().map(d => ({id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor})));

const state = async (app: ElectronApplication) => (await getWindowStates(app)).main!;

async function moveTo(app: ElectronApplication, target: DisplayInfo, width = 1000, height = 700): Promise<Rect> {
  const bounds: Rect = {
    x: target.workArea.x + Math.round((target.workArea.width - width) / 2),
    y: target.workArea.y + Math.round((target.workArea.height - height) / 2),
    width,
    height
  };
  await app.evaluate((_electron, b) => (globalThis as any).__yallE2E.getWindows().mainWindow.setBounds(b), bounds);
  await expect.poll(async () => (await state(app)).display.id, {timeout: 10_000, message: `window on display ${target.id}`}).toBe(target.id);
  return bounds;
}

/** After a move the canvas backing store must follow the new display's pixel ratio and the paused picture must be drawn again. */
async function expectSurfaceOn(app: ElectronApplication, ui: Parameters<typeof canvasMatchesContainer>[0], target: DisplayInfo): Promise<void> {
  await expect.poll(() => ui.evaluate(() => window.devicePixelRatio), {timeout: 10_000, message: 'devicePixelRatio of the new display'})
    .toBeCloseTo(target.scaleFactor, 2);
  await expect.poll(async () => (await canvasMatchesContainer(ui)).ok, {timeout: 10_000, message: JSON.stringify(await canvasMatchesContainer(ui))}).toBe(true);
  const sender = await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats());
  if (sender?.backend && sender.backend !== 'readback') {
    // The render size of a shared backend is the canvas backing size
    const canvas = await canvasMatchesContainer(ui);
    await expect.poll(async () => (await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats())).addon.width, {timeout: 10_000})
      .toBeGreaterThan(canvas.canvas[0] - 3);
  }
  await expectPictureFillsContainer(app, ui);
}

// These need two displays (the dev PC has them, CI does not). Scaling differences between the displays are what makes
// them interesting, but a second display with the same scaling still catches a window that lands on the wrong screen.
test.describe('two displays', () => {
  test('moving the window to the other display re-fits the canvas to that display and redraws the picture', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
    await waitForPlayer(ui);
    await restoreIfMaximized(app);
    const all = await displays(app);
    test.skip(all.length < 2, 'needs two displays');
    const originId = (await state(app)).display.id;
    const origin = all.find(d => d.id === originId)!;
    const other = all.find(d => d.id !== origin.id)!;
    test.info().annotations.push({type: 'displays', description: JSON.stringify(all.map(d => ({id: d.id, scale: d.scaleFactor, bounds: d.bounds})))});

    await moveTo(app, other);
    await expectSurfaceOn(app, ui, other);

    await moveTo(app, origin);
    await expectSurfaceOn(app, ui, origin);
  });

  test('fullscreen on the other display stays there and leaving it restores the window on that display', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
    await waitForPlayer(ui);
    await restoreIfMaximized(app);
    const all = await displays(app);
    test.skip(all.length < 2, 'needs two displays');
    const originId = (await state(app)).display.id;
    const origin = all.find(d => d.id === originId)!;
    const other = all.find(d => d.id !== origin.id)!;

    const placed = await moveTo(app, other);
    await expectSurfaceOn(app, ui, other);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(true);
    await expect.poll(async () => {
      const main = await state(app);
      return rectsClose(main.bounds, other.bounds, 2) ? 'fills display' : `main ${JSON.stringify(main.bounds)} display ${JSON.stringify(other.bounds)}`;
    }, {timeout: 10_000, message: 'fullscreen fills the other display'}).toBe('fills display');
    await expectPictureFillsContainer(app, ui);

    await ui.waitForTimeout(600);
    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(false);
    await expect.poll(async () => {
      const main = await state(app);
      return main.display.id === other.id && rectsClose(main.bounds, placed, 4)
        ? 'restored on the other display'
        : `display ${main.display.id} (want ${other.id}), bounds ${JSON.stringify(main.bounds)} (want ${JSON.stringify(placed)})`;
    }, {timeout: 10_000, message: 'leaving fullscreen keeps the window on its display'}).toBe('restored on the other display');
    await withWindows(app, ({mainWindow}) => mainWindow.isResizable());
    await expectSurfaceOn(app, ui, other);
  });
});
