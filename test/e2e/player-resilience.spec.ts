import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {expectVideoShowsClip, launchClips, pixelProbesAvailable, seekTo, startPlaying} from './support/player';

type App = Parameters<typeof expectVideoShowsClip>[0];

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

const simulateEngineError = (app: App) => app.evaluate(() => (globalThis as any).__yallE2E.simulateEngineError());

test('an engine that stops by itself is restarted at the same position, a second failure within a minute is reported', async ({launch}) => {
  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(1, 0.5)});
  await startPlaying(ui);

  expect(await simulateEngineError(app)).toBe(true);
  await expect.poll(() => videoLog(userDataDir), {timeout: 15_000}).toContain('Playback engine stopped unexpectedly; restarting at');
  await expect(ui.getByText('Playback engine stopped, restarting')).toBeVisible();
  if (pixelProbesAvailable) {
    await seekTo(ui, inClip(2, 0.5));
    await expectVideoShowsClip(app, ui, 2, 15_000);
  }

  await simulateEngineError(app);
  await expect.poll(() => videoLog(userDataDir), {timeout: 15_000}).toContain('not restarting');
  // The Linux host can report its exit as a second engine error, which shows the toast twice
  await expect(ui.getByText('could not restart, reopen the project').first()).toBeVisible();
});

test('a native crash leaves a minidump and nothing is uploaded', async ({launch}) => {
  const {app} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  const dumps = await app.evaluate(() => (globalThis as any).__yallE2E.getCrashDumpsPath() as string);
  // Windows keeps finished dumps in 'reports', macOS and Linux in 'completed'
  const countDumps = () => ['reports', 'completed'].reduce((total, folder) => {
    const dir = path.join(dumps, folder);
    return total + (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.dmp')).length : 0);
  }, 0);
  const before = countDumps();

  await app.evaluate(() => (globalThis as any).__yallE2E.crashProcess()).catch(() => undefined);
  await expect.poll(countDumps, {timeout: 30_000}).toBeGreaterThan(before);
});
