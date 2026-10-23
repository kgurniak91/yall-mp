import * as fs from 'fs';
import * as path from 'path';
import {execFileSync} from 'child_process';
import {expect, test} from './support/app';
import {isGreen} from './support/capture';
import {CLIPS_DURATION, clipsSeed, inClip} from './support/clips';
import {latestPlayback, recordPlayback, waitForPlayer} from './support/playback';
import {
  expectVideoShowsClip, goToProjectList, launchClips, mpvProp, mpvTime, openProjectFromList, pixelProbesAvailable, probeVideoColor, quiet,
  startPlaying, waitForTime
} from './support/player';
import {fixture, SEED_PROJECT_ID_2, seedProject, seedProjects} from './support/seed';

// Opening, switching and closing projects while the player is running.

test('opening another project and coming back twice shows the right video each time, with no stale frame', async ({launch}) => {
  const {app, ui} = await launch({
    seed: dir => seedProjects(dir, [
      clipsSeed({lastPlaybackTime: inClip(3, 0.5), globalSettings: {volume: 40}}),
      {id: SEED_PROJECT_ID_2, media: fixture('sample.mp4'), subtitle: fixture('sample.srt'), duration: 10, lastPlaybackTime: 4}
    ])
  });
  await waitForPlayer(ui);
  await recordPlayback(ui);

  const expectClips = async (): Promise<void> => {
    await expect.poll(() => mpvTime(ui), {message: 'mpv should be at the resume position of the clips project'}).toBeCloseTo(inClip(3, 0.5), 1);
    expect(Number(await mpvProp(ui, 'duration'))).toBeCloseTo(CLIPS_DURATION, 1);
    if (pixelProbesAvailable) {
      await expectVideoShowsClip(app, ui, 3);
    }
  };
  const expectSample = async (): Promise<void> => {
    await expect.poll(() => mpvTime(ui), {message: 'mpv should be at the resume position of sample.mp4'}).toBeCloseTo(4, 1);
    expect(Number(await mpvProp(ui, 'duration'))).toBeCloseTo(10, 1);
    if (pixelProbesAvailable) {
      await expect.poll(async () => isGreen(await probeVideoColor(app, ui)), {message: 'sample.mp4 at 4 s is green'}).toBe(true);
    }
  };

  await expectClips();
  expect(Number(await mpvProp(ui, 'volume'))).toBe(40);

  // First switch: clips -> sample
  await goToProjectList(ui);
  await openProjectFromList(ui, 'sample.mp4');
  await expectSample();

  // The volume chosen in one project is the volume of the next
  await ui.evaluate(() => (window as any).electronAPI.playbackSetVolume(25));
  await expect.poll(async () => (await latestPlayback(ui))?.volume).toBe(25);

  // Second switch: sample -> clips
  await goToProjectList(ui);
  await openProjectFromList(ui, 'clips.mp4');
  await expectClips();
  expect(Number(await mpvProp(ui, 'volume'))).toBe(25);

  // And a third, to be sure nothing accumulates: clips -> sample, then play it
  await goToProjectList(ui);
  await openProjectFromList(ui, 'sample.mp4');
  await expectSample();
  await startPlaying(ui);
  await waitForTime(ui, t => t > 4.4, 'the last project plays');
});

test('closing the window during playback exits promptly and leaves no mpv process behind', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.3)});
  await startPlaying(ui);
  await waitForTime(ui, t => t > inClip(3, 0.3) + 0.2, 'playing');

  const mainPid = app.process().pid!;
  // The mpv-window player runs mpv as a child process; the libmpv player has none, so this is simply an empty list there
  const children = childMpvPids(mainPid);
  const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve()));

  const started = Date.now();
  await ui.evaluate(() => (window as any).electronAPI.windowClose()).catch(() => undefined);
  const outcome = await Promise.race([exited.then(() => 'exited'), quiet(10_000).then(() => 'still running')]);
  const took = Date.now() - started;

  expect(outcome, 'the app should exit after the window is closed').toBe('exited');
  expect(took, `exit took ${took} ms`).toBeLessThan(3000);
  await quiet(500);
  for (const pid of children) {
    expect(isAlive(pid), `mpv process ${pid} must not outlive the app`).toBe(false);
  }
  test.info().annotations.push({type: 'mpv-children', description: String(children.length)});
});

test('a corrupt media file shows an error and returns to the project list', async ({launch}) => {
  const {ui} = await launch({
    seed: dir => {
      const corrupt = path.join(dir, 'corrupt.mp4');
      fs.writeFileSync(corrupt, 'this is not a video');
      seedProject(dir, clipsSeed({media: corrupt}));
    }
  });

  await expect(ui.locator('.p-toast-message').filter({hasText: 'failed to start'})).toBeVisible({timeout: 30_000});
  await expect(ui.locator('h1')).toContainText('List of projects');
});

function childMpvPids(parentPid: number): number[] {
  if (process.platform !== 'win32') {
    return [];
  }
  const out = execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} AND Name='mpv.exe'" | ForEach-Object { $_.ProcessId }`
  ], {encoding: 'utf8'});
  return out.split(/\s+/).filter(Boolean).map(Number);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
