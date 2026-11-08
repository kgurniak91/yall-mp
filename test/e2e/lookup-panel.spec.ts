import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {getWindowStates} from './support/windows';

// The subtitles lookup panel: a window of its own on Windows and macOS, a view inside the main window on Linux (a
// Wayland client cannot place a window, it would open in the top-left corner of the screen).
test('the lookup panel opens centred over the main window at 80 percent and closes again', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir)});
  await waitForPlayer(ui);

  const panel = () => app.evaluate(() => (globalThis as any).__yallE2E.getLookupPanel());
  expect(await panel()).toBeNull();

  await ui.evaluate(() => (window as any).electronAPI.openSubtitlesLookupWindow({
    url: 'data:text/html,<body style="background:white"><h1>lookup test page</h1></body>',
    clipSubtitleId: 'clip-1',
    originalSelection: 'test'
  }));

  await expect.poll(async () => (await panel())?.visible, {timeout: 10_000}).toBe(true);
  const open = (await panel())!;
  const main = (await getWindowStates(app)).main!.bounds;
  expect(Math.abs(open.size[0] - main.width * 0.8)).toBeLessThanOrEqual(8);
  expect(Math.abs(open.size[1] - main.height * 0.8)).toBeLessThanOrEqual(8);
  expect(open.insideMainWindow).toBe(process.platform === 'linux');
  // The page shows the backdrop that closes the panel on a click
  await expect(ui.locator('.lookup-window-backdrop')).toHaveCount(1);

  await ui.evaluate(() => (window as any).electronAPI.closeLookupWindow());
  await expect.poll(async () => (await panel())?.visible, {timeout: 10_000}).toBe(false);
  await expect(ui.locator('.lookup-window-backdrop')).toHaveCount(0);

  // A second open reuses the panel
  await ui.evaluate(() => (window as any).electronAPI.openSubtitlesLookupWindow({
    url: 'data:text/html,<h1>second</h1>', clipSubtitleId: 'clip-1', originalSelection: 'again'
  }));
  await expect.poll(async () => (await panel())?.visible, {timeout: 10_000}).toBe(true);
});
