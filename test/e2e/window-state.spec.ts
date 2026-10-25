import type {Page} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {expectPictureFillsContainer} from './support/capture';
import {getWindowStates, rectsClose, restoreIfMaximized, withWindows} from './support/windows';
import {VIDEO_AREA, mpvPaused} from './support/player';

const icon = (ui: Page, name: string) => ui.locator(`.window-controls-wrapper .${name}`);
const state = async (app: Parameters<typeof getWindowStates>[0]) => (await getWindowStates(app)).main!;
// Electron on Wayland reports a work area that ignores the panel and dock
const linux = process.platform === 'linux';
const workAreaTolerance = linux ? 96 : 16;
// Mutter restores a slightly smaller window than the one that was maximized
const restoreTolerance = linux ? 64 : 4;
const appRegion = (ui: Page) => ui.locator('.header-wrapper').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region'));

test.describe('window state', () => {
  test('maximize, minimize/restore and fullscreen keep the picture and the controls in sync', async ({launch}) => {
    // Paused at 1 s: the all-red picture has to be redrawn after every window change
    const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
    await waitForPlayer(ui);
    await expectPictureFillsContainer(app, ui);
    expect((await getWindowStates(app)).visibleWindows).toBe(1);

    if (linux) {
      await restoreIfMaximized(app);
    }
    const initial = await state(app);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await expect.poll(async () => (await state(app)).isMaximized, {timeout: 10_000}).toBe(true);
    // Native maximize fills the work area of the window's own display
    await expect.poll(async () => rectsClose((await state(app)).bounds, initial.display.workArea, workAreaTolerance), {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-window-restore')).toBeVisible();
    await expectPictureFillsContainer(app, ui);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await expect.poll(async () => (await state(app)).isMaximized, {timeout: 10_000}).toBe(false);
    await expect.poll(async () => rectsClose((await state(app)).bounds, initial.bounds, restoreTolerance), {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-window-maximize')).toBeVisible();
    await expectPictureFillsContainer(app, ui);

    await ui.evaluate(() => (window as any).electronAPI.windowMinimize());
    await expect.poll(async () => (await state(app)).isMinimized, {timeout: 10_000}).toBe(true);
    await withWindows(app, ({mainWindow}) => mainWindow.restore());
    await expect.poll(async () => (await state(app)).isMinimized, {timeout: 10_000}).toBe(false);
    await expectPictureFillsContainer(app, ui);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-compress')).toBeVisible();
    await expectPictureFillsContainer(app, ui);
    // No drag region in fullscreen: the header would swallow clicks meant for the video
    expect(await appRegion(ui)).toBe('no-drag');

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(false);
    await expect(icon(ui, 'fa-expand')).toBeVisible();
    expect(await appRegion(ui)).toBe('drag');
    await expectPictureFillsContainer(app, ui);
  });

  test('F11 enters fullscreen and Escape leaves it', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    await ui.keyboard.press('F11');
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(true);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(false);
  });

  test('Escape chain: fullscreen, then unmaximize, then minimize', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    if (linux) {
      await restoreIfMaximized(app);
    }

    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await expect.poll(async () => (await state(app)).isMaximized, {timeout: 10_000}).toBe(true);
    await ui.keyboard.press('F11');
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(true);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(false);
    expect((await state(app)).isMinimized).toBe(false);
    // Leaving fullscreen puts the maximized state back; the next key press has to find it settled
    await expect.poll(async () => (await state(app)).isMaximized, {timeout: 10_000}).toBe(true);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await state(app)).isMaximized, {timeout: 10_000}).toBe(false);
    expect((await state(app)).isMinimized).toBe(false);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await state(app)).isMinimized, {timeout: 10_000}).toBe(true);
  });

  test('Escape closes a dialog and does not minimize the window', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    await ui.keyboard.press('o');
    const dialog = ui.locator('.p-dialog');
    await expect(dialog).toBeVisible();

    await ui.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Give a wrongly handled Escape time to minimize, then check that it did not
    await new Promise(r => setTimeout(r, 500));
    expect((await state(app)).isMinimized).toBe(false);
  });

  test('double-clicking the video toggles fullscreen and does not start playback', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    await ui.locator(VIDEO_AREA).dblclick({force: true});
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(true);
    expect(await mpvPaused(ui)).toBe(true);

    await ui.locator(VIDEO_AREA).dblclick({force: true});
    await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000}).toBe(false);
  });

  test('fullscreen can be entered repeatedly and fills the display every time', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    const initial = await state(app);

    for (const round of [1, 2, 3]) {
      await ui.keyboard.press('F11');
      await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000, message: `enter #${round}`}).toBe(true);
      await expect.poll(async () => {
        const main = await state(app);
        return rectsClose(main.bounds, main.display.bounds, 2) ? 'fills display' : `main ${JSON.stringify(main.bounds)} display ${JSON.stringify(main.display.bounds)}`;
      }, {timeout: 10_000, message: `fullscreen #${round} fills the display`}).toBe('fills display');

      await ui.waitForTimeout(600);
      await ui.keyboard.press('Escape');
      await expect.poll(async () => (await state(app)).isFullScreen, {timeout: 10_000, message: `leave #${round}`}).toBe(false);
      await expect.poll(() => withWindows(app, ({mainWindow}) => mainWindow.isResizable()),
        {timeout: 10_000, message: `window resizable again #${round}`}).toBe(true);
      await expect.poll(async () => {
        const {bounds} = await state(app);
        return rectsClose(bounds, initial.bounds, 4) ? 'restored' : `${JSON.stringify(bounds)} != initial ${JSON.stringify(initial.bounds)}`;
      }, {timeout: 10_000, message: `restored bounds #${round}`}).toBe('restored');
      // Re-entering within ~150 ms of leaving makes Electron save mid-transition bounds, a human toggle is slower than that
      await ui.waitForTimeout(400);
    }
  });
});
