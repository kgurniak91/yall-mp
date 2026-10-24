import type {ElectronApplication} from '@playwright/test';
import {expect, test} from './support/app';
import {goToProjectList, launchClips, press, startPlaying, waitForState} from './support/player';

const isBlocked = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__yallE2E.isDisplaySleepBlocked());

test('the display is kept awake while playing and released on pause', async ({launch}) => {
  const {app, ui} = await launchClips(launch);
  expect(await isBlocked(app)).toBe(false);

  await startPlaying(ui);
  await expect.poll(() => isBlocked(app), {timeout: 10_000}).toBe(true);

  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  await expect.poll(() => isBlocked(app), {timeout: 10_000}).toBe(false);
});

test('the display is released when leaving the player while playing', async ({launch}) => {
  const {app, ui} = await launchClips(launch);
  await startPlaying(ui);
  await expect.poll(() => isBlocked(app), {timeout: 10_000}).toBe(true);

  await goToProjectList(ui);
  await expect.poll(() => isBlocked(app), {timeout: 10_000}).toBe(false);
});
