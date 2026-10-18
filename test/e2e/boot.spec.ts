import {expect, test} from './support/app';
import {seedListOnly} from './support/seed';

test('boots with an empty profile: splash host exists, then the new-project form', async ({launch}) => {
  const {app, ui} = await launch();

  const host = app.windows().find(p => p.url().includes('draggable-host'));
  expect(host, 'draggable-host (mainWindow) page').toBeTruthy();
  await expect(host!.locator('#skeleton-view')).toBeAttached();

  await expect(ui.locator('h1')).toContainText('Create New Project');

  const devToolsOpen = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().uiWindow.webContents.isDevToolsOpened());
  expect(devToolsOpen).toBe(false);
  const visible = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().uiWindow.isVisible());
  expect(visible).toBe(true);
});

test('lists a seeded project', async ({launch}) => {
  const {ui} = await launch({seed: dir => seedListOnly(dir)});

  await expect(ui.locator('h1')).toContainText('List of projects');
  await expect(ui.getByText('sample.mp4').first()).toBeVisible();
});
