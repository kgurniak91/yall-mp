import * as fs from 'fs';
import {expect, test} from './support/app';
import {clipsSeed, inClip} from './support/clips';
import {recordPlayback, waitForPlayer} from './support/playback';
import {goToProjectList, mpvProp, openProjectFromList, quiet} from './support/player';
import {fixture, SEED_PROJECT_ID_2, seedProjects} from './support/seed';

// Every project switch tears the video attachment down and sets a new one up (two attaches in a row, 20 times here).
// Nothing may pile up: the playback engine process keeps about the same memory and the same number of open files
// (the dma-buf / socket descriptors of the frame transport are the ones that would leak).
test.skip(process.platform !== 'linux', 'reads the process memory and descriptors from /proc');
test.setTimeout(600_000);

const SWITCHES = Number(process.env['YALL_E2E_SWITCHES'] ?? 20);

function readStat(pid: number): { comm: string; ppid: number } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return {
      comm: stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')')),
      ppid: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    };
  } catch {
    return null; // the process went away while reading
  }
}

/** The app's process and all its descendants. */
function processTree(rootPid: number): number[] {
  const parents = new Map<number, number>();
  for (const entry of fs.readdirSync('/proc')) {
    if (/^\d+$/.test(entry)) {
      const stat = readStat(Number(entry));
      if (stat) {
        parents.set(Number(entry), stat.ppid);
      }
    }
  }
  const tree = [rootPid];
  for (let i = 0; i < tree.length; i++) {
    for (const [pid, ppid] of parents) {
      if (ppid === tree[i]) {
        tree.push(pid);
      }
    }
  }
  return tree;
}

const rssMB = (pid: number): number => {
  try {
    const kb = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return kb ? Number(kb[1]) / 1024 : 0;
  } catch {
    return 0;
  }
};

const openFiles = (pid: number): number => {
  try {
    return fs.readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    return 0;
  }
};

function measure(appPid: number): { hosts: number; hostRssMB: number; hostFds: number; mainFds: number; treeRssMB: number } {
  const tree = processTree(appPid);
  const hosts = tree.filter(pid => readStat(pid)?.comm.startsWith('yall-mpv-host'));
  return {
    hosts: hosts.length,
    hostRssMB: hosts.reduce((sum, pid) => sum + rssMB(pid), 0),
    hostFds: hosts.reduce((sum, pid) => sum + openFiles(pid), 0),
    mainFds: openFiles(appPid),
    treeRssMB: tree.reduce((sum, pid) => sum + rssMB(pid), 0)
  };
}

test(`${SWITCHES} project switches leave the engine's memory and descriptors where they were`, async ({launch}) => {
  const {app, ui} = await launch({
    seed: dir => seedProjects(dir, [
      clipsSeed({lastPlaybackTime: inClip(3, 0.5)}),
      {id: SEED_PROJECT_ID_2, media: fixture('sample.mp4'), subtitle: fixture('sample.srt'), duration: 10, lastPlaybackTime: 4}
    ])
  });
  await waitForPlayer(ui);
  await recordPlayback(ui);
  const appPid = app.process().pid!;

  // One round trip first: the first attach allocates the pools and caches
  for (const media of ['sample.mp4', 'clips.mp4']) {
    await goToProjectList(ui);
    await openProjectFromList(ui, media);
  }
  await quiet(1500);
  const before = measure(appPid);
  expect(before.hosts, 'the engine runs in its own process').toBe(1);

  for (let i = 0; i < SWITCHES; i++) {
    const media = i % 2 === 0 ? 'sample.mp4' : 'clips.mp4';
    await goToProjectList(ui);
    await openProjectFromList(ui, media);
    await expect.poll(async () => Number(await mpvProp(ui, 'duration')), {message: `switch ${i + 1} loaded ${media}`}).toBeGreaterThan(5);
  }

  await quiet(1500);
  const after = measure(appPid);
  const summary = `engine processes ${before.hosts} -> ${after.hosts}, engine RSS ${before.hostRssMB.toFixed(0)} -> ${after.hostRssMB.toFixed(0)} MB, ` +
    `engine fds ${before.hostFds} -> ${after.hostFds}, main fds ${before.mainFds} -> ${after.mainFds}, ` +
    `app tree RSS ${before.treeRssMB.toFixed(0)} -> ${after.treeRssMB.toFixed(0)} MB`;
  test.info().annotations.push({type: 'after-switches', description: summary});
  console.log(`[project-switch] ${summary}`);

  // Every switch may start a fresh engine process, but the old ones must be gone
  expect(after.hosts, 'no engine process is left behind').toBe(1);
  expect(after.hostFds, 'open descriptors of the engine').toBeLessThanOrEqual(before.hostFds + 4);
  expect(after.mainFds, 'open descriptors of the main process').toBeLessThanOrEqual(before.mainFds + 8);
  expect(after.hostRssMB - before.hostRssMB, 'engine memory growth in MB').toBeLessThan(150);
  expect(after.treeRssMB - before.treeRssMB, 'whole app memory growth in MB').toBeLessThan(300);
});
