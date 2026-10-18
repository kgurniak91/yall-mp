import type {ElectronApplication, Page} from '@playwright/test';
import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {getWindowStates, rectContains, rectsClose, withWindows} from './support/windows';

/** Baseline invariant of the 3-window stack: ui follows main, and the video sits inside the ui. */
async function expectStackInSync(app: ElectronApplication): Promise<void> {
  await expect.poll(async () => {
    const {main, ui, video} = await getWindowStates(app);
    if (!main || !ui) {
      return 'missing main/ui';
    }
    if (!rectsClose(main.bounds, ui.bounds, 2)) {
      return `ui ${JSON.stringify(ui.bounds)} != main ${JSON.stringify(main.bounds)}`;
    }
    if (video?.isVisible && !rectContains(ui.bounds, video.bounds, 2)) {
      return `video ${JSON.stringify(video.bounds)} outside ui ${JSON.stringify(ui.bounds)}`;
    }
    return 'ok';
  }, {timeout: 10_000}).toBe('ok');
}

const icon = (ui: Page, name: string) => ui.locator(`.window-controls-wrapper .${name}`);

test.describe('window state (3-window baseline)', () => {
  test('maximize, minimize/restore and fullscreen keep the stack in sync', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);
    await expectStackInSync(app);

    const initial = (await getWindowStates(app)).main!;

    // Today's maximize is custom: isMaximized() stays false, so assert on bounds (documented baseline)
    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await expect.poll(async () => rectsClose((await getWindowStates(app)).main!.bounds, initial.display.workArea, 4), {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-window-restore')).toBeVisible();
    await expectStackInSync(app);
    test.info().annotations.push({type: 'baseline', description: `isMaximized() after toggle: ${(await getWindowStates(app)).main!.isMaximized}`});

    await ui.evaluate(() => (window as any).electronAPI.windowToggleMaximize());
    await expect.poll(async () => rectsClose((await getWindowStates(app)).main!.bounds, initial.bounds, 4), {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-window-maximize')).toBeVisible();
    await expectStackInSync(app);

    await ui.evaluate(() => (window as any).electronAPI.windowMinimize());
    await expect.poll(async () => (await getWindowStates(app)).main!.isMinimized, {timeout: 10_000}).toBe(true);
    await withWindows(app, ({mainWindow}) => mainWindow.restore());
    await expect.poll(async () => (await getWindowStates(app)).main!.isMinimized, {timeout: 10_000}).toBe(false);
    await expect.poll(async () => (await getWindowStates(app)).ui!.opacity, {timeout: 10_000}).toBe(1);
    await expectStackInSync(app);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(true);
    await expect(icon(ui, 'fa-compress')).toBeVisible();
    await expectStackInSync(app);

    await ui.evaluate(() => (window as any).electronAPI.windowToggleFullScreen());
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(false);
    await expect(icon(ui, 'fa-expand')).toBeVisible();
    await expectStackInSync(app);
  });

  test('F11 enters fullscreen and Escape leaves it', async ({launch}) => {
    const {app, ui} = await launch({seed: dir => seedProject(dir)});
    await waitForPlayer(ui);

    await ui.keyboard.press('F11');
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(true);

    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await getWindowStates(app)).main!.isFullScreen, {timeout: 10_000}).toBe(false);
  });
});
