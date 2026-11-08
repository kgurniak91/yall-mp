import * as fs from 'fs';
import * as path from 'path';
import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {expectVideoShowsClip, launchClips, mpvTime, pixelProbesAvailable, press, seekTo, startPlaying, waitForState} from './support/player';

// On Linux the playback engine runs in its own process (`yall-mpv-host`). A host that dies for real (SIGKILL: the
// kernel's OOM killer, a user's `kill -9`, a driver bug taking the process down) must not take the app with it: the
// engine restarts at the saved position and the picture comes back. This is the real process death, as opposed to the
// simulated engine error in player-resilience.spec.ts.
test.skip(process.platform !== 'linux', 'the engine only runs in a separate host process on Linux');

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

/** Pids of the host processes that are children of the app's main process. */
function hostPids(appPid: number): number[] {
  const pids: number[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (ppid === appPid && comm.startsWith('yall-mpv-host')) {
        pids.push(Number(entry));
      }
    } catch {
      // the process went away while reading
    }
  }
  return pids;
}

const countDumps = async (app: Parameters<typeof expectVideoShowsClip>[0]): Promise<number> => {
  const dumps = await app.evaluate(() => (globalThis as any).__yallE2E.getCrashDumpsPath() as string);
  return ['reports', 'completed', 'pending'].reduce((total, folder) => {
    const dir = path.join(dumps, folder);
    return total + (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.dmp')).length : 0);
  }, 0);
};

for (const playing of [true, false]) {
  test(`a killed engine process is restarted at the same position (${playing ? 'while playing' : 'while paused'})`, async ({launch}) => {
    const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(1, 0.5)});
    const appPid = app.process().pid!;
    await startPlaying(ui);
    if (!playing) {
      await press(ui, 'Space');
      await waitForState(ui, 'PausedByUser');
    }
    const hostsBefore = hostPids(appPid);
    expect(hostsBefore).toHaveLength(1);
    const timeBefore = await mpvTime(ui);
    const dumpsBefore = await countDumps(app);

    process.kill(hostsBefore[0], 'SIGKILL');

    await expect.poll(() => videoLog(userDataDir), {timeout: 15_000}).toContain('Playback engine stopped unexpectedly; restarting at');
    await expect(ui.getByText('Playback engine stopped, restarting')).toBeVisible();
    await expect.poll(() => hostPids(appPid), {timeout: 15_000}).toHaveLength(1);
    expect(hostPids(appPid)[0]).not.toBe(hostsBefore[0]);
    // The player state does not change when the engine was already paused, so it says nothing about the restart. The
    // new engine is up once it has seeked to the position the log names; a seek sent before that is overridden by it.
    const resumeAt = Number(/restarting at ([\d.]+) s/.exec(videoLog(userDataDir))![1]);
    expect(Math.abs(resumeAt - timeBefore)).toBeLessThan(3);
    await expect.poll(async () => Math.abs(await mpvTime(ui).catch(() => Infinity) - resumeAt), {timeout: 20_000, message: 'the new engine resumes at the saved position'}).toBeLessThan(0.3);
    await waitForState(ui, 'PausedByUser', 20_000);

    // The picture is alive: another clip can be shown
    if (pixelProbesAvailable) {
      await seekTo(ui, inClip(2, 0.5));
      await expectVideoShowsClip(app, ui, 2, 15_000);
    }

    // The app itself did not crash: nothing of ours left a minidump (the host is not a Crashpad process)
    expect(await countDumps(app)).toBe(dumpsBefore);
  });
}
