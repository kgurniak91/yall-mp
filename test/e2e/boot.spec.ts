import {expect, test} from './support/app';
import {seedListOnly} from './support/seed';
import {getWindowStates} from './support/windows';

test('boots with an empty profile into the new-project form, in one window', async ({launch}) => {
  const {app, ui} = await launch();

  await expect(ui.locator('h1')).toContainText('Create New Project');
  expect(ui.url()).toContain('/dist/yall-mp/browser/');
  // The splash inside <app-root> is replaced on bootstrap
  await expect(ui.locator('.splash')).toHaveCount(0);

  const devToolsOpen = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().mainWindow.webContents.isDevToolsOpened());
  expect(devToolsOpen).toBe(false);
  const {main, visibleWindows} = await getWindowStates(app);
  expect(main!.isVisible).toBe(true);
  expect(visibleWindows).toBe(1);
});

test('lists a seeded project', async ({launch}) => {
  const {ui} = await launch({seed: dir => seedListOnly(dir)});

  await expect(ui.locator('h1')).toContainText('List of projects');
  await expect(ui.getByText('sample.mp4').first()).toBeVisible();
});
