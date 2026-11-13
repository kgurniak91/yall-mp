import type {ElectronApplication} from '@playwright/test';
import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {goToProjectList, launchClips, press, startPlaying, waitForState} from './support/player';

const isBlocked = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(() => (globalThis as any).__yallE2E.isDisplaySleepBlocked());

test('the display is kept awake while playing and released on pause', async ({launch}) => {
  // Start inside a subtitled clip: the leading gap plays at double speed and is over in half a second, and a Space
  // that lands in the clip-boundary transition after it resumes instead of pausing
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(1, 0.1)});
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
