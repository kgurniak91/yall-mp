// Soak test of the video path: plays a looped file for an hour while cycling seek / pause+resume / resize / speed
// override every 30 s and closing + reopening the project every 10 min, and samples memory and the leak counters
// every minute. Writes a CSV of the samples and a JSON summary with the pass/fail verdict.
//
//   node scripts/soak-video.js [--minutes=60] [--file=spikes/libmpv-poc/media/1080p30-h264.mp4] [--out=soak-result]
//                              [--warmup-min=10] [--actions=seek,pause-resume,resize,speed|none] [--reopen-min=N] [--reopen-min=10] [--sample-sec=60] [--action-sec=30]
//   YALL_MP_VIDEO_BACKEND / YALL_MP_VIDEO_ADAPTER are passed through to the app (e.g. readback + warp for the software path).
//
// Needs `npm run electron:build` first. Exit code 1 when a criterion fails:
//   growth per process type < 30 MB/h (renderer JS heap < 10 MB/h, fitted over the second half of the run; the fit after
//   the warm-up is reported next to it; the renderer is sampled after a forced GC), inFlight <= pool size,
//   reclaimed == 0, sendFailures == 0, open VideoFrames <= 2, listener counts constant across reopen cycles,
//   addon liveCounts back to the same values after each reopen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {_electron} = require('@playwright/test');

const REPO = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));
const MINUTES = parseFloat(args.minutes || '60');
const WARMUP_MIN = parseFloat(args['warmup-min'] || '10');
const REOPEN_MS = parseFloat(args['reopen-min'] || '10') * 60_000;
const SAMPLE_MS = parseFloat(args['sample-sec'] || '60') * 1000;
const ACTION_MS = parseFloat(args['action-sec'] || '30') * 1000;
const ONLY_ACTIONS = args.actions ? String(args.actions).split(',') : null;
const file = path.resolve(REPO, args.file || 'spikes/libmpv-poc/media/1080p30-h264.mp4');
const outBase = path.resolve(args.out || 'soak-result');
const ID = '00000000-0000-4000-8000-00000000e2e0';
const srt = path.join(REPO, 'test', 'e2e', 'fixtures', 'sample.srt');
const MB = 1024 * 1024;

if (!fs.existsSync(file)) {
  console.error(`Media file not found: ${file}`);
  process.exit(1);
}

function seed(dir) {
  const now = Date.now();
  const minimal = {
    id: ID, catalogId: 'ROOT_CATALOG', mediaFileName: path.basename(file), subtitleFileName: 'sample.srt', mediaPath: file,
    createdDate: now, lastOpenedDate: now, duration: 90, lastPlaybackTime: 0, subtitleCount: 3, lastSubtitleEndTime: 8.5
  };
  const project = {
    ...minimal, subtitleSelection: {type: 'external', filePath: srt}, detectedLanguage: 'other', subtitles: [], audioTracks: [],
    subtitleTracks: [], ankiTags: [], settings: {
      autoPauseAtStart: false, autoPauseAtEnd: false, subtitledClipSpeed: 1, gapSpeed: 1, skipGaps: false, speedOverride: 0.5,
      subtitleBehavior: 'DoNothing', selectedAudioTrackIndex: null, useMpvSubtitles: false, assScale: 1, assScalePercentage: 100,
      subtitlesVisible: true, subtitlesLanguage: 'other', defaultSubtitleLookupServiceId: null
    }
  };
  fs.mkdirSync(path.join(dir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'yall-mp-app-data.json'),
    JSON.stringify({projects: [minimal], lastOpenedProjectId: ID, globalSettings: {hardwareAcceleration: true}}));
  fs.writeFileSync(path.join(dir, 'projects', `${ID}.json`), JSON.stringify(project));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function findUi(app) {
  for (let i = 0; i < 150; i++) {
    for (const page of app.windows()) {
      if (!page.url().includes('/dist/yall-mp/browser/')) {
        continue;
      }
      if (await page.evaluate(() => typeof window.electronAPI?.windowMinimize === 'function').catch(() => false)) {
        return page;
      }
    }
    await sleep(200);
  }
  throw new Error('No UI window');
}

async function waitForPlayer(ui) {
  await ui.locator('#video-container .resizing-overlay').waitFor({state: 'detached', timeout: 30000});
  await ui.locator('.interaction-blocker').waitFor({state: 'detached', timeout: 30000}).catch(() => undefined);
  await ui.bringToFront().catch(() => undefined);
}

/** Looped playback: the file is shorter than the soak. */
async function startPlayback(ui) {
  await ui.evaluate(() => window.electronAPI.mpvSetProperty('loop-file', 'inf'));
  await ui.keyboard.press('Space');
  await sleep(2500);
}

async function reopenProject(ui) {
  await ui.locator('.menu-button-wrapper button').click();
  await ui.getByText('List of projects').click();
  await ui.locator('h1').filter({hasText: 'List of projects'}).waitFor({timeout: 15000});
  await sleep(1000);
  if (process.env.SOAK_REOPEN_MODE === 'form') {
    await ui.getByText('Create New Project').click();
    await sleep(1500);
    return;
  }
  try {
    await ui.locator('.project-card').first().click({timeout: 15000});
  } catch (error) {
    console.error('project list when the card was missing:', (await ui.locator('body').innerText().catch(() => '?')).slice(0, 600));
    throw error;
  }
  await waitForPlayer(ui);
  if (!process.env.SOAK_NO_PLAY_AFTER_REOPEN) {
    await startPlayback(ui);
  }
}

const ACTIONS = [
  ['seek', async (ui) => ui.evaluate(() => window.electronAPI.playbackSeek(Math.random() * 80, true))],
  ['pause-resume', async (ui) => { await ui.keyboard.press('Space'); await sleep(1500); await ui.keyboard.press('Space'); }],
  ['resize', async (_ui, app, step) => app.evaluate((_e, size) => {
    const win = globalThis.__yallE2E.getWindows().mainWindow;
    const b = win.getBounds();
    win.setBounds({x: b.x, y: b.y, width: size.width, height: size.height});
  }, step % 2 ? {width: 1280, height: 720} : {width: 1600, height: 900})],
  ['speed', async (ui) => { await ui.evaluate(() => window.electronAPI.playbackSetSpeedOverride(true)); await sleep(3000); await ui.evaluate(() => window.electronAPI.playbackSetSpeedOverride(false)); }]
];

/** Linux only: RSS of the out-of-process libmpv host, i.e. a child of the main process that Electron's metrics do not list. */
function linuxHostRssMB(knownPids) {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const mainPid = knownPids.find(pid => {
      try {
        return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').every(a => !a.startsWith('--type='));
      } catch {
        return false;
      }
    });
    const out = require('child_process').execSync('ps -eo pid=,ppid=,rss=', {encoding: 'utf8'});
    let total = 0;
    for (const line of out.trim().split(/\r?\n/)) {
      const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
      if (ppid === mainPid && !knownPids.includes(pid)) {
        total += rss / 1024;
      }
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

async function sample(app, ui, t0) {
  const metrics = await app.evaluate(({app: electronApp}) => electronApp.getAppMetrics().map(m => ({
    pid: m.pid, type: m.type, workingSetMB: m.memory.workingSetSize / 1024, privateMB: (m.memory.privateBytes ?? 0) / 1024
  })));
  const byType = {};
  const hostRssMB = linuxHostRssMB(metrics.map(m => m.pid));
  if (hostRssMB !== null) {
    byType.libmpvHost = {workingSetMB: hostRssMB, privateMB: hostRssMB};
  }
  for (const m of metrics) {
    const entry = byType[m.type] ??= {workingSetMB: 0, privateMB: 0};
    entry.workingSetMB += m.workingSetMB;
    entry.privateMB += m.privateMB;
  }
  await ui.evaluate(() => { if (typeof window.gc === 'function') { window.gc(); } }).catch(() => undefined);
  const page = await ui.evaluate(() => ({
    heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    stats: window.__yallVideoStats ? {...window.__yallVideoStats} : null,
    pn: globalThis.__buses ? globalThis.__buses.map(b => Object.fromEntries([...b].map(([k, v]) => [k, v.length]))) : null,
    canvas: window.__canvasTrack ? JSON.parse(JSON.stringify(window.__canvasTrack)) : null
  })).catch(() => ({heapMB: null, stats: null}));
  const sender = await app.evaluate(() => globalThis.__yallE2E.getVideoStats());
  const live = await app.evaluate(() => globalThis.__yallE2E.getLiveCounts());
  const listeners = await app.evaluate(() => globalThis.__yallE2E.getListenerCounts());
  return {
    minute: Number(((Date.now() - t0) / 60000).toFixed(2)), byType, heapMB: page.heapMB, canvas: page.canvas, pn: page.pn,
    openFrames: page.stats ? page.stats.received - page.stats.closed : null, pageStats: page.stats,
    backend: sender?.backend, inFlight: sender?.addon?.inFlight, poolSize: sender?.addon?.poolSize ?? sender?.addon?.slots,
    reclaimed: sender?.addon?.reclaimed, sendFailures: sender?.sendFailures, staleDropped: sender?.staleDropped, live, listeners
  };
}

/** Least-squares slope of y over x (x in minutes), returned per hour. */
function slopePerHour(points) {
  if (points.length < 3) {
    return null;
  }
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const num = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den === 0 ? null : (num / den) * 60;
}

function evaluate(samples, reopenSnapshots) {
  const failures = [];
  const warm = samples.filter(s => s.minute >= WARMUP_MIN);
  const lastMinute = samples.at(-1)?.minute ?? 0;
  const secondHalf = samples.filter(s => s.minute >= lastMinute / 2);
  const growth = {};
  const growthSecondHalf = {};
  const types = new Set(samples.flatMap(s => Object.keys(s.byType)));
  const fit = (list, pick, limit, label, gate) => {
    const g = slopePerHour(list.filter(s => pick(s) !== null && pick(s) !== undefined).map(s => [s.minute, pick(s)]));
    if (gate && g !== null && g >= limit) {
      failures.push(`${label} grows ${g.toFixed(1)} MB/h over the second half (limit ${limit})`);
    }
    return g === null ? null : Number(g.toFixed(1));
  };
  for (const type of types) {
    const pick = s => s.byType[type] ? (s.byType[type].privateMB || s.byType[type].workingSetMB) : null;
    growth[type] = fit(warm, pick, 30, type, false);
    growthSecondHalf[type] = fit(secondHalf, pick, 30, type, true);
  }
  growth.rendererJsHeap = fit(warm, s => s.heapMB, 10, 'renderer JS heap', false);
  growthSecondHalf.rendererJsHeap = fit(secondHalf, s => s.heapMB, 10, 'renderer JS heap', true);
  const worst = (key, pick) => Math.max(0, ...samples.map(s => pick(s) ?? 0));
  const maxInFlight = worst('inFlight', s => s.inFlight);
  const pool = samples.find(s => s.poolSize)?.poolSize ?? 4;
  if (maxInFlight > pool) {
    failures.push(`inFlight reached ${maxInFlight} (pool ${pool})`);
  }
  if (worst('reclaimed', s => s.reclaimed) !== 0) {
    failures.push('slots were reclaimed');
  }
  if (worst('sendFailures', s => s.sendFailures) !== 0) {
    failures.push('frame send failures');
  }
  const maxOpen = worst('openFrames', s => s.openFrames);
  if (maxOpen > 2) {
    failures.push(`${maxOpen} VideoFrames open at once (limit 2)`);
  }
  const [first, ...rest] = reopenSnapshots;
  for (const snap of rest) {
    if (JSON.stringify(snap.listeners) !== JSON.stringify(first.listeners)) {
      failures.push(`listener counts changed after reopen at minute ${snap.minute}`);
    }
    // Slots are allocated lazily and held while a frame is in flight, so they are bounded, not compared
    const {slots: firstSlots, ...firstCounts} = first.live;
    const {slots, ...counts} = snap.live;
    if (JSON.stringify(counts) !== JSON.stringify(firstCounts) || slots > Math.max(4, firstSlots)) {
      failures.push(`addon liveCounts changed after reopen at minute ${snap.minute}: ${JSON.stringify(snap.live)} vs ${JSON.stringify(first.live)}`);
    }
  }
  return {growthMBPerHour: growth, growthSecondHalfMBPerHour: growthSecondHalf, maxInFlight, maxOpenFrames: maxOpen, failures, pass: failures.length === 0};
}

function writeCsv(samples) {
  const types = [...new Set(samples.flatMap(s => Object.keys(s.byType)))];
  const header = ['minute', 'backend', 'heapMB', 'openFrames', 'inFlight', 'reclaimed', 'sendFailures', 'staleDropped',
    ...types.flatMap(t => [`${t}_privateMB`, `${t}_workingSetMB`])];
  const rows = samples.map(s => [s.minute, s.backend, s.heapMB?.toFixed(1), s.openFrames, s.inFlight, s.reclaimed, s.sendFailures, s.staleDropped,
    ...types.flatMap(t => [s.byType[t]?.privateMB.toFixed(1), s.byType[t]?.workingSetMB.toFixed(1)])]);
  fs.writeFileSync(`${outBase}.csv`, [header, ...rows].map(r => r.join(',')).join('\n'));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-soak-'));
  seed(dir);
  const app = await _electron.launch({args: ['.', '--js-flags=--expose-gc', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], cwd: REPO, env: {...process.env, YALL_MP_E2E: '1', YALL_MP_USER_DATA_DIR: dir}});
  const samples = [];
  const reopenSnapshots = [];
  try {
    const ui = await findUi(app);
    await waitForPlayer(ui);
    if (process.env.SOAK_PAGE_ERRORS) {
      ui.on('pageerror', error => console.log(`PAGEERROR ${String(error.stack ?? error).slice(0, 600)}`));
      ui.on('console', msg => msg.type() === 'error' && console.log(`CONSOLE.ERROR ${msg.text().slice(0, 600)}`));
    }
    if (process.env.SOAK_CANVAS_TRACK) {
      await ui.evaluate(() => {
        const stats = window.__canvasTrack = {created: 0, finalized: 0, byKind: {}};
        const registry = new FinalizationRegistry(kind => { stats.finalized++; stats.byKind[kind].finalized++; });
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (!this.__tracked) {
            this.__tracked = true;
            const kind = `${type}:${this.getRootNode() instanceof ShadowRoot ? 'shadow' : this.isConnected ? 'dom' : 'detached'}`;
            stats.created++;
            (stats.byKind[kind] ??= {created: 0, finalized: 0}).created++;
            registry.register(this, kind);
          }
          return original.call(this, type, ...rest);
        };
      });
    }
    await app.evaluate(() => {
      const win = globalThis.__yallE2E.getWindows().mainWindow;
      const b = win.getBounds();
      win.setBounds({x: b.x, y: b.y, width: 1600, height: 900});
    });
    await sleep(800);
    await startPlayback(ui);
    reopenSnapshots.push({minute: 0, listeners: await app.evaluate(() => globalThis.__yallE2E.getListenerCounts()),
      live: await app.evaluate(() => globalThis.__yallE2E.getLiveCounts())});

    const t0 = Date.now();
    const end = t0 + MINUTES * 60_000;
    let nextSample = t0 + SAMPLE_MS;
    let nextAction = t0 + ACTION_MS;
    let nextReopen = t0 + REOPEN_MS;
    let step = 0;
    while (Date.now() < end) {
      await sleep(1000);
      const now = Date.now();
      if (now >= nextReopen && now < end - 60_000) {
        nextReopen += REOPEN_MS;
        await reopenProject(ui);
        reopenSnapshots.push({minute: Number(((Date.now() - t0) / 60000).toFixed(2)),
          listeners: await app.evaluate(() => globalThis.__yallE2E.getListenerCounts()),
          live: await app.evaluate(() => globalThis.__yallE2E.getLiveCounts())});
        console.log(`minute ${reopenSnapshots.at(-1).minute}: project reopened`);
      } else if (now >= nextAction) {
        nextAction += ACTION_MS;
        const actions = ONLY_ACTIONS ? ACTIONS.filter(a => ONLY_ACTIONS.includes(a[0])) : ACTIONS;
        if (actions.length === 0) {
          nextAction = Infinity;
          continue;
        }
        const [name, run] = actions[step % actions.length];
        await run(ui, app, Math.floor(step / actions.length)).catch(error => console.warn(`action ${name} failed: ${error.message}`));
        step++;
      }
      if (Date.now() >= nextSample) {
        nextSample += SAMPLE_MS;
        const s = await sample(app, ui, t0);
        samples.push(s);
        if (s.pn) {
          console.log(`  primeng listeners ${JSON.stringify(s.pn)}`);
        }
        if (s.canvas) {
          console.log(`  canvases created ${s.canvas.created} finalized ${s.canvas.finalized} ${JSON.stringify(s.canvas.byKind)}`);
        }
        console.log(`minute ${s.minute}: ${s.backend} heap ${s.heapMB?.toFixed(0)} MB, open frames ${s.openFrames}, inFlight ${s.inFlight}, ` +
          Object.entries(s.byType).map(([t, v]) => `${t} ${(v.privateMB || v.workingSetMB).toFixed(0)}`).join(', '));
      }
    }
    samples.push(await sample(app, ui, t0));
    if (process.env.SOAK_HEAP_SNAPSHOT) {
      const cdp = await ui.context().newCDPSession(ui);
      const chunks = [];
      cdp.on('HeapProfiler.addHeapSnapshotChunk', ({chunk}) => chunks.push(chunk));
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.takeHeapSnapshot', {reportProgress: false});
      fs.writeFileSync(process.env.SOAK_HEAP_SNAPSHOT, chunks.join(''));
    }
  } finally {
    await app.close().catch(() => undefined);
    await sleep(2000);
    fs.rmSync(dir, {recursive: true, force: true});
  }
  writeCsv(samples);
  const verdict = evaluate(samples, reopenSnapshots);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({file: path.basename(file), minutes: MINUTES, warmupMin: WARMUP_MIN,
    backend: process.env.YALL_MP_VIDEO_BACKEND ?? 'auto', ...verdict, reopenSnapshots, samples}, null, 2));
  console.log(verdict.pass ? 'SOAK PASS' : `SOAK FAIL:\n  ${verdict.failures.join('\n  ')}`);
  console.log(`growth MB/h after warm-up: ${JSON.stringify(verdict.growthMBPerHour)}`);
  console.log(`growth MB/h second half (gates): ${JSON.stringify(verdict.growthSecondHalfMBPerHour)}`);
  process.exit(verdict.pass ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
