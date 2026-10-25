import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {expectVideoShowsClip, launchClips, pixelProbesAvailable, startPlaying} from './support/player';

// The black-frame check of the shared backends. These read pixels, so they need a real GPU and a real screen.
test.skip(!pixelProbesAvailable, 'pixel probes need a real GPU and screen');

type App = Parameters<typeof expectVideoShowsClip>[0];

const videoStats = (app: App) => app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats());

test('the page confirms the first frames of a shared backend', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  test.skip((await videoStats(app))?.backend === 'readback', 'needs the GPU path');

  await startPlaying(ui);
  await expect.poll(async () => (await videoStats(app))?.validation, {timeout: 10_000}).toBe('confirmed');
  expect((await videoStats(app)).backend).not.toBe('readback');
});

test('frames that import as black end on readback with a picture', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)}, {
    env: {YALL_MP_E2E_SIMULATE_BLACK_FRAMES: '1'}
  });
  const forced = process.env['YALL_MP_VIDEO_BACKEND'] === 'readback';
  test.skip(forced, 'needs the GPU path');

  await startPlaying(ui);
  await expect.poll(async () => (await videoStats(app))?.backend, {timeout: 15_000}).toBe('readback');
  const stats = await videoStats(app);
  expect(stats.fallbackReason).toContain('page read black');
  expect(stats.validation).toBe('black');
  await expectVideoShowsClip(app, ui, 0);
});
