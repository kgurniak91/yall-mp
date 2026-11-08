import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {ElectronApplication} from '@playwright/test';
import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {launchClips, mpvProp, quiet, startPlaying, waitForState, waitForTime} from './support/player';

// Changing the system's default output device while playing (a headset taken off, the monitor's speakers chosen in the
// sound settings) must not stop or crash playback. PipeWire is driven through `wpctl`, so this runs only on a Linux
// session that has at least two sinks.
test.skip(process.platform !== 'linux', 'drives the PipeWire default sink');

interface Sink {
  id: string;
  name: string;
  isDefault: boolean;
}

function wpctl(...args: string[]): string {
  return execFileSync('wpctl', args, {encoding: 'utf8', timeout: 10_000});
}

/** The sinks under the "Sinks:" heading of `wpctl status`. */
function listSinks(): Sink[] {
  let status: string;
  try {
    status = wpctl('status');
  } catch {
    return [];
  }
  const sinks: Sink[] = [];
  let inSinks = false;
  for (const line of status.split('\n')) {
    if (/Sinks:/.test(line)) {
      inSinks = true;
      continue;
    }
    if (inSinks && /(Sink endpoints|Sources|Source endpoints|Streams):/.test(line)) {
      break;
    }
    const match = inSinks ? /^[\s│├└─]*(\*)?\s*(\d+)\.\s+(.+?)(\s+\[vol:.*)?$/.exec(line) : null;
    if (match) {
      sinks.push({id: match[2], name: match[3], isDefault: !!match[1]});
    }
  }
  return sinks;
}

const videoLog = (userDataDir: string): string => {
  try {
    return fs.readFileSync(path.join(userDataDir, 'video.log'), 'utf8');
  } catch {
    return '';
  }
};

const countDumps = async (app: ElectronApplication): Promise<number> => {
  const dumps = await app.evaluate(() => (globalThis as any).__yallE2E.getCrashDumpsPath() as string);
  return ['reports', 'completed', 'pending'].reduce((total, folder) => {
    const dir = path.join(dumps, folder);
    return total + (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.dmp')).length : 0);
  }, 0);
};

test('switching the default sink back and forth while playing keeps the clock running', async ({launch}) => {
  const sinks = listSinks();
  test.skip(sinks.length < 2, 'needs two PipeWire sinks');
  const original = sinks.find(sink => sink.isDefault) ?? sinks[0];

  const {app, ui, userDataDir} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.2)});
  const dumpsBefore = await countDumps(app);
  await startPlaying(ui);
  await waitForTime(ui, time => time > inClip(0, 0.2) + 0.5, 'playback starts');
  const output = await mpvProp(ui, 'current-ao').catch(() => null);
  test.info().annotations.push({type: 'audio-output', description: `${output} on ${original.name}`});

  try {
    for (let round = 0; round < 3; round++) {
      for (const sink of sinks) {
        wpctl('set-default', sink.id);
        const before = Number(await mpvProp(ui, 'time-pos'));
        await quiet(1200);
        const after = Number(await mpvProp(ui, 'time-pos'));
        expect(after, `the clock moves after switching to ${sink.name} (round ${round + 1})`).toBeGreaterThan(before);
        await waitForState(ui, ['Playing', 'AutoPaused']);
      }
    }
  } finally {
    wpctl('set-default', original.id);
  }

  expect(videoLog(userDataDir)).not.toContain('Playback engine stopped');
  expect(await countDumps(app)).toBe(dumpsBefore);
});
