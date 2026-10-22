import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {baseline} from './support/baseline';
import {getWindowStates, rectsClose, withWindows} from './support/windows';

/** Baseline invariant of the window stack: ui follows main. */
async function expectStackInSync(app: ElectronApplication): Promise<void> {
  await expect.poll(async () => {
    const {main, ui} = await getWindowStates(app);
    if (!main || !ui) {
      return 'missing main/ui';
    }
    if (!rectsClose(main.bounds, ui.bounds, 2)) {
      return `ui ${JSON.stringify(ui.bounds)} != main ${JSON.stringify(main.bounds)}`;
    }
    return 'ok';
  }, {timeout: 10_000}).toBe('ok');
}

const icon = (ui: Page, name: string) => ui.locator(`.window-controls-wrapper .${name}`);

test.describe('window state', () => {
  test('maximize, minimize/restore and fullscreen keep the stack in sync', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    await baseline('stack in sync #1', () => expectStackInSync(app));

    const initial = (await getWindowStates(app)).main!;

    // Today's maximize is custom: isMaximized() stays false, so assert on bounds (documented baseline)
    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await baseline('bounds #2', () => expect.poll(async () => rectsClose((await getWindowStates(app)).main!.bounds, initial.display.workArea, 4), {timeout: 10_000}).toBe(true));
    await baseline('icon fa-window-restore', () => expect(icon(ui, 'fa-window-restore')).toBeVisible());
    await baseline('stack in sync #3', () => expectStackInSync(app));
    test.info().annotations.push({type: 'baseline', description: `isMaximized() after toggle: ${(await getWindowStates(app)).main!.isMaximized}`});

    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await baseline('bounds #4', () => expect.poll(async () => rectsClose((await getWindowStates(app)).main!.bounds, initial.bounds, 4), {timeout: 10_000}).toBe(true));
    await baseline('icon fa-window-maximize', () => expect(icon(ui, 'fa-window-maximize')).toBeVisible());
    await baseline('stack in sync #5', () => expectStackInSync(app));

    await ui.evaluate(() => (window as any).electronAPI.windowMinimize());
    await expect.poll(async () => (await getWindowStates(app)).main!.isMinimized, {timeout: 10_000}).toBe(true);
    await withWindows(app, ({mainWindow}) => mainWindow.restore());
    await expect.poll(async () => (await getWindowStates(app)).main!.isMinimized, {timeout: 10_000}).toBe(false);
    await expect.poll(async () => (await getWindowStates(app)).ui!.opacity, {timeout: 10_000}).toBe(1);
    await baseline('stack in sync #6', () => expectStackInSync(app));

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(true);
    await baseline('icon fa-compress', () => expect(icon(ui, 'fa-compress')).toBeVisible());
    await baseline('stack in sync #7', () => expectStackInSync(app));

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(false);
    await baseline('icon fa-expand', () => expect(icon(ui, 'fa-expand')).toBeVisible());
    await baseline('stack in sync #8', () => expectStackInSync(app));
  });

  test('F11 enters fullscreen and Escape leaves it', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    await ui.keyboard.press('F11');
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(true);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(false);
  });

  test('fullscreen can be entered repeatedly and fills the display every time', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    const initial = (await getWindowStates(app)).main!;

    for (const round of [1, 2, 3]) {
      await ui.keyboard.press('F11');
      await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000, message: `enter #${round}`}).toBe(true);
      await expect.poll(async () => {
        const {main} = await getWindowStates(app);
        return rectsClose(main!.bounds, main!.display.bounds, 2) ? 'fills display' : `main ${JSON.stringify(main!.bounds)} display ${JSON.stringify(main!.display.bounds)}`;
      }, {timeout: 10_000, message: `fullscreen #${round} fills the display`}).toBe('fills display');
      // The stacked ui window is offset on macOS (recorded baseline), so only Windows asserts it
      await baseline(`ui fills the display #${round}`, () => expect.poll(async () => {
        const {main, ui: uiState} = await getWindowStates(app);
        return rectsClose(uiState!.bounds, main!.display.bounds, 2) ? 'fills display' : `ui ${JSON.stringify(uiState!.bounds)} display ${JSON.stringify(main!.display.bounds)}`;
      }, {timeout: 10_000}).toBe('fills display'));

      // Let the fullscreen resize lock (setResizable(false) after a resize debounce) kick in before leaving
      await ui.waitForTimeout(600);
      await ui.keyboard.press('Escape');
      await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000, message: `leave #${round}`}).toBe(false);
      await expect.poll(() => withWindows(app, ({mainWindow, uiWindow}) => mainWindow.isResizable() && uiWindow.isResizable()),
        {timeout: 10_000, message: `windows resizable again #${round}`}).toBe(true);
      await expect.poll(async () => {
        const {bounds} = (await getWindowStates(app)).main!;
        return rectsClose(bounds, initial.bounds, 4) ? 'restored' : `${JSON.stringify(bounds)} != initial ${JSON.stringify(initial.bounds)}`;
      }, {timeout: 10_000, message: `restored bounds #${round}`}).toBe('restored');
      // Re-entering within ~150 ms of leaving makes Electron save mid-transition bounds, a human toggle is slower than that
      await ui.waitForTimeout(400);
    }
  });
});
