import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {launchClips, startPlaying, waitForTime} from './support/player';

// How long a frame takes from the render thread to the draw call on the canvas. The numbers are recorded with the run; the
// bounds are loose on purpose (hosted runners are slow), they catch a pipeline that stalls, not a few milliseconds.
test('frames reach the canvas promptly and every frame carries its render timestamp', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.2)});
  await startPlaying(ui);
  await waitForTime(ui, time => time > inClip(0, 0.2) + 2, 'two seconds of playback');

  const surface = await ui.evaluate(() => ({...(window as any).__yallVideoStats}));
  const sender = await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats());
  test.info().annotations.push({
    type: 'latency',
    description: `backend ${sender?.backend}: samples ${surface.latencySamples}, p50 ${surface.latencyP50Ms.toFixed(1)} ms, p95 ${surface.latencyP95Ms.toFixed(1)} ms, max ${surface.latencyMaxMs.toFixed(1)} ms`
  });

  expect(surface.latencySamples).toBeGreaterThan(20);
  expect(surface.latencyP50Ms).toBeGreaterThan(0);
  expect(surface.latencyP50Ms).toBeLessThan(process.env['CI'] ? 400 : 100);
  expect(surface.latencyP95Ms).toBeLessThan(process.env['CI'] ? 1000 : 250);
});
