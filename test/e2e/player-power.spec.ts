import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {
  expectVideoShowsClip, launchClips, mpvProp, pixelProbesAvailable, press, seekTo, startPlaying, waitForState, waitForTime
} from './support/player';

type App = Parameters<typeof expectVideoShowsClip>[0];

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

// Goes through the real powerMonitor listeners (the main process emits the event on the powerMonitor itself).
const emitPower = (app: App, name: 'suspend' | 'resume') =>
  app.evaluate((_, event) => (globalThis as any).__yallE2E.emitPowerEvent(event), name);

const isDisplayBlocked = (app: App): Promise<boolean> => app.evaluate(() => (globalThis as any).__yallE2E.isDisplaySleepBlocked());

test('the machine going to sleep pauses playback and releases the display', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  await startPlaying(ui);
  await expect.poll(() => isDisplayBlocked(app), {timeout: 10_000}).toBe(true);

  await emitPower(app, 'suspend');
  await waitForState(ui, 'PausedByUser');
  await expect.poll(() => isDisplayBlocked(app), {timeout: 10_000}).toBe(false);
  expect(videoLog(userDataDir)).toContain('System suspend; pausing playback');

  // Waking up does not start playing again by itself
  await emitPower(app, 'resume');
  await expect.poll(() => videoLog(userDataDir), {timeout: 15_000}).toContain('Resume check:');
  expect((await ui.evaluate(() => (window as any).electronAPI.mpvGetProperty('pause')))).toBeTruthy();
});

test('sleeping while paused changes nothing, and the picture is drawn again after waking', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(1, 0.5)});
  await seekTo(ui, inClip(1, 0.5));
  const before = (await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats())).sent as number;

  await emitPower(app, 'suspend');
  await emitPower(app, 'resume');
  await expect.poll(() => videoLog(userDataDir), {timeout: 15_000}).toContain('Resume check: ok.');

  const log = videoLog(userDataDir);
  expect(log).toContain('System suspend; nothing is playing');
  expect(log).not.toContain('Resume check: reattached');
  // The check asked for one more frame of the paused picture
  const after = (await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats())).sent as number;
  expect(after).toBeGreaterThan(before);
  if (pixelProbesAvailable) {
    await expectVideoShowsClip(app, ui, 1, 10_000);
  }

  // Playing still works afterwards
  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
});

test('playback continues silently when the audio device cannot be opened', async ({launch}) => {
  const {ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.2)}, {
    env: {YALL_MP_E2E_MPV_OPTIONS: JSON.stringify({'audio-device': 'nonexistent/device'})}
  });
  await startPlaying(ui);
  await waitForTime(ui, time => time > inClip(0, 0.2) + 0.6, 'the clock keeps running without audio');
  // mpv gave up on the device and opened the silent output instead of dropping the audio chain
  await expect.poll(() => mpvProp(ui, 'current-ao').catch(() => 'none'), {timeout: 10_000}).toBe('null');
  await expect.poll(() => videoLog(userDataDir), {timeout: 10_000}).toContain('Audio output: driver=null');
});
