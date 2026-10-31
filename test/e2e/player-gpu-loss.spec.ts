import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {captureComposited} from './support/capture';
import {inClip} from './support/clips';
import {
  expectVideoShowsClip, goToProjectList, launchClips, mpvPaused, openProjectFromList, pixelProbesAvailable, press, quiet, seekTo, startPlaying, VIDEO_AREA
} from './support/player';

// Losing the GPU (Chromium's GPU process, or libmpv's own device) must end in a picture, never a black window. These read
// pixels and kill processes, so they need a real GPU and screen.
test.skip(!pixelProbesAvailable, 'pixel probes need a real GPU and screen');

type App = Parameters<typeof expectVideoShowsClip>[0];

const videoStats = (app: App) => app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats());
const backendOf = async (app: App): Promise<string | undefined> => (await videoStats(app))?.backend;

const killGpuProcess = (app: App): Promise<number | null> => app.evaluate(({app: electronApp}) => {
  const gpu = electronApp.getAppMetrics().find(metric => metric.type === 'GPU');
  if (!gpu) {
    return null;
  }
  process.kill(gpu.pid);
  return gpu.pid;
});

const gpuCompositingEnabled = (app: App): Promise<boolean> =>
  app.evaluate(({app: electronApp}) => String(electronApp.getGPUFeatureStatus().gpu_compositing).startsWith('enabled'));

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

/** Pauses, jumps into a clip and expects its colour: the whole path from mpv to the canvas works. */
async function expectPictureRecovered(app: App, ui: Parameters<typeof seekTo>[0], clip: number): Promise<void> {
  await seekTo(ui, inClip(clip, 0.5));
  await expectVideoShowsClip(app, ui, clip, 15_000);
}

test('a killed GPU process falls back to readback, the next project tries the GPU again, a second kill stays on readback', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  test.skip((await backendOf(app)) === 'readback', 'needs the GPU path');
  const backend = await backendOf(app);

  await startPlaying(ui);
  await press(ui, 'Space');
  expect(await killGpuProcess(app), 'a GPU process to kill').not.toBeNull();

  await expect.poll(() => backendOf(app), {timeout: 15_000}).toBe('readback');
  expect((await videoStats(app)).fallbackReason).toContain('GPU process gone');
  expect(videoLog(userDataDir)).toContain('GPU process gone');
  await expectPictureRecovered(app, ui, 2);

  // Second project open: the shared backend again, as long as Chromium has GPU compositing
  const compositing = await gpuCompositingEnabled(app);
  await goToProjectList(ui);
  await openProjectFromList(ui, 'clips.mp4');
  await expect.poll(() => backendOf(app), {timeout: 15_000}).toBe(compositing ? backend : 'readback');
  expect(videoLog(userDataDir)).toContain(`gpuLosses=1`);
  await expectPictureRecovered(app, ui, 1);

  // A second loss in the same run: readback until restart
  if (compositing) {
    await killGpuProcess(app);
    await expect.poll(() => backendOf(app), {timeout: 15_000}).toBe('readback');
  }
  await goToProjectList(ui);
  await openProjectFromList(ui, 'clips.mp4');
  expect(await backendOf(app)).toBe('readback');
  await expectPictureRecovered(app, ui, 3);
});

test('a lost libmpv device is replaced by a new one and the picture comes back', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  test.skip((await backendOf(app)) === 'readback', 'needs the GPU path');
  const before = await videoStats(app);

  expect(await app.evaluate(() => (globalThis as any).__yallE2E.simulateDeviceLost())).toBe(true);
  await expect.poll(async () => (await videoStats(app))?.attachId, {timeout: 15_000}).not.toBe(before.attachId);

  const after = await videoStats(app);
  expect(after.backend).toBe(before.backend);
  expect(after.fallbackReason).toContain('GPU device lost');
  expect(videoLog(userDataDir)).toContain('the GPU device was lost');
  await expectPictureRecovered(app, ui, 2);
});

test('two GPU process losses in one run, the second while paused, leave a live picture on screen', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  test.skip((await backendOf(app)) === 'readback', 'needs the GPU path');

  const screenColor = async () => {
    const box = await ui.locator(VIDEO_AREA).first().boundingBox();
    const content = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().mainWindow.getContentBounds());
    return (await captureComposited(app, [{x: content.x + box!.x + box!.width / 2, y: content.y + box!.y + box!.height / 2}])).colors[0];
  };

  await startPlaying(ui);
  expect(await killGpuProcess(app)).not.toBeNull();
  await expect.poll(() => backendOf(app), {timeout: 15_000}).toBe('readback');
  await quiet(2000);

  // Pause for sure: after the engine reload the transport state is not what a blind Space toggles
  if (!(await mpvPaused(ui))) {
    await press(ui, 'Space');
  }
  await expect.poll(() => mpvPaused(ui), {timeout: 10_000}).toBe(true);
  await seekTo(ui, inClip(2, 0.5));
  await expectVideoShowsClip(app, ui, 2, 15_000);
  await quiet(1000);
  expect(await killGpuProcess(app), 'a second GPU process to kill').not.toBeNull();
  await quiet(4000);

  const color = await screenColor();
  const log = videoLog(userDataDir);
  expect(log, 'renderer must not die').not.toContain('Renderer process gone');
  expect(color, `composited centre of the video area ${JSON.stringify(color)}`).not.toBeNull();
  const nearWhite = color!.r > 200 && color!.g > 200 && color!.b > 200;
  expect(nearWhite, `video area went white: ${JSON.stringify(color)}`).toBe(false);
  await expectVideoShowsClip(app, ui, 2, 15_000);

  // Playing again must deliver new frames, not only keep the old one on screen
  const pageDrawn = (): Promise<number> => ui.evaluate(() => (window as any).__yallVideoStats?.drawn ?? 0);
  const drawnBefore = await pageDrawn();
  await press(ui, 'Space');
  await expect.poll(async () => (await pageDrawn()) - drawnBefore, {
    timeout: 10_000, message: 'frames must be drawn after resuming'
  }).toBeGreaterThan(5);
});

test('a lost device of the readback attach (after a GPU process loss) is replaced while paused and playback draws frames again', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  test.skip((await backendOf(app)) === 'readback', 'needs the GPU path');

  await startPlaying(ui);
  expect(await killGpuProcess(app)).not.toBeNull();
  await expect.poll(() => backendOf(app), {timeout: 15_000}).toBe('readback');
  await quiet(2000);
  if (!(await mpvPaused(ui))) {
    await press(ui, 'Space');
  }
  await expect.poll(() => mpvPaused(ui), {timeout: 10_000}).toBe(true);
  await seekTo(ui, inClip(2, 0.5));
  await expectVideoShowsClip(app, ui, 2, 15_000);

  const before = await videoStats(app);
  expect(await app.evaluate(() => (globalThis as any).__yallE2E.simulateDeviceLost())).toBe(true);
  await expect.poll(async () => (await videoStats(app))?.attachId, {timeout: 15_000}).not.toBe(before.attachId);
  expect((await videoStats(app)).backend).toBe('readback');
  expect(videoLog(userDataDir)).toContain('the GPU device was lost');
  await expectVideoShowsClip(app, ui, 2, 15_000);

  const pageDrawn = (): Promise<number> => ui.evaluate(() => (window as any).__yallVideoStats?.drawn ?? 0);
  const drawnBefore = await pageDrawn();
  await press(ui, 'Space');
  await expect.poll(async () => (await pageDrawn()) - drawnBefore, {
    timeout: 10_000, message: 'frames must be drawn after resuming'
  }).toBeGreaterThan(5);
});
