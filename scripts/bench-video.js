// Video path benchmark: launches the app on a seeded project, plays the file and samples the CPU of the whole
// Electron process tree (browser, GPU, renderer, utility), together with the frames the page presented in the same
// window. Windows samples with the PowerShell sampler (CPU, GPU engines, dwm); macOS samples `ps` cputime once a
// second (CPU only; WindowServer is reported in the dwm field, GPU is null: use powermetrics alongside).
//
//   node scripts/bench-video.js [--file=spikes/libmpv-poc/media/1080p60-h264.mp4] [--hwdec=auto|no|both]
//                               [--runs=3] [--warmup=10] [--measure=60] [--size=1600x900] [--out=bench-video.json]
//   YALL_MP_VIDEO_BACKEND / YALL_MP_VIDEO_ADAPTER are passed through to the app.
//
// Needs `npm run electron:build` first. Prints % of one core, ms of CPU per presented frame and the mpv drop counters.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn, execFileSync} = require('child_process');
const {_electron} = require('@playwright/test');

const REPO = path.resolve(__dirname, '..');
const SAMPLER = path.join(REPO, 'scripts', 'bench', 'sampler.ps1');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));
const file = path.resolve(REPO, args.file || 'spikes/libmpv-poc/media/1080p60-h264.mp4');
const hwdecModes = args.hwdec === 'both' || !args.hwdec ? ['auto', 'no'] : [args.hwdec];
const RUNS = parseInt(args.runs || '3', 10);
const WARMUP = parseFloat(args.warmup || '10');
const MEASURE = parseFloat(args.measure || '60');
const [WIDTH, HEIGHT] = String(args.size || '1600x900').split('x').map(Number);
const ID = '00000000-0000-4000-8000-00000000e2e0';
const srt = path.join(REPO, 'test', 'e2e', 'fixtures', 'sample.srt');

if (process.platform !== 'win32' && process.platform !== 'darwin') {
  console.error('bench-video.js samples the process tree on Windows and macOS only.');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Media file not found: ${file}`);
  process.exit(1);
}

function seed(dir, hwdec) {
  const now = Date.now();
  const minimal = {
    id: ID, catalogId: '', mediaFileName: path.basename(file), subtitleFileName: 'sample.srt', mediaPath: file,
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
    JSON.stringify({projects: [minimal], lastOpenedProjectId: ID, globalSettings: {hardwareAcceleration: hwdec === 'auto'}}));
  fs.writeFileSync(path.join(dir, 'projects', `${ID}.json`), JSON.stringify(project));
}

const runSampler = (pid, out) => new Promise(resolve => {
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SAMPLER, '-RootPid', String(pid),
    '-WarmupSec', String(WARMUP + 1), '-DurationSec', String(Math.max(5, MEASURE - 2)), '-Out', out], {stdio: 'ignore'}).on('exit', resolve);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** `ps` cputime ([[dd-]hh:]mm:ss.ss) in seconds. */
const cpuSeconds = text => {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  return rest.split(':').reduce((sum, part) => sum * 60 + parseFloat(part), 0) + Number(days) * 86400;
};

const psLines = columns => execFileSync('ps', ['-A', '-o', columns], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).split('\n');

/**
 * pid -> {ppid, cpu, name} of every process. The name is the executable (`comm`, which may contain spaces); an
 * Electron helper's name carries its --type (gpu-process, renderer, utility) from the arguments.
 */
function psSnapshot() {
  const types = new Map();
  for (const line of psLines('pid=,args=')) {
    const m = /^\s*(\d+)\s.*--type=(\S+)/.exec(line);
    if (m) {
      types.set(Number(m[1]), m[2]);
    }
  }
  const procs = new Map();
  for (const line of psLines('pid=,ppid=,time=,comm=')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const pid = Number(m[1]);
    const base = path.basename(m[4].trim());
    const type = types.get(pid);
    procs.set(pid, {ppid: Number(m[2]), cpu: cpuSeconds(m[3]), name: type ? `${base} (${type})` : base});
  }
  return procs;
}

/** The macOS counterpart of sampler.ps1, with the same output fields where they apply. */
async function runPsSampler(rootPid, out) {
  await sleep((WARMUP + 1) * 1000);
  const end = Date.now() + Math.max(5, MEASURE - 2) * 1000;
  const tree = procs => {
    const ids = new Set([rootPid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [pid, p] of procs) {
        if (ids.has(p.ppid) && !ids.has(pid)) {
          ids.add(pid);
          grew = true;
        }
      }
    }
    return ids;
  };
  const samples = [];
  let prev = psSnapshot();
  let prevAt = Date.now();
  while (Date.now() < end) {
    await sleep(1000);
    const now = psSnapshot();
    const at = Date.now();
    const dt = (at - prevAt) / 1000;
    const byName = {};
    for (const pid of tree(now)) {
      const a = prev.get(pid);
      const b = now.get(pid);
      if (a && b) {
        byName[b.name] = (byName[b.name] ?? 0) + (b.cpu - a.cpu) / dt * 100;
      }
    }
    const ws = [...now].find(([, p]) => p.name === 'WindowServer');
    const wsPrev = ws && prev.get(ws[0]);
    if (ws && wsPrev) {
      byName.dwm = (ws[1].cpu - wsPrev.cpu) / dt * 100;
    }
    samples.push(byName);
    prev = now;
    prevAt = at;
  }
  const names = new Set(samples.flatMap(s => Object.keys(s)));
  const cpu = {};
  for (const n of names) {
    cpu[n] = Number((samples.reduce((sum, s) => sum + (s[n] ?? 0), 0) / Math.max(1, samples.length)).toFixed(2));
  }
  const appCpu = Object.entries(cpu).filter(([n]) => n !== 'dwm').reduce((sum, [, v]) => sum + v, 0);
  const cores = os.cpus().length;
  fs.writeFileSync(out, JSON.stringify({
    rootPid, cores, samples: samples.length, cpuPctOfOneCoreByProcess: cpu, appCpuPctOfOneCore: Number(appCpu.toFixed(2)),
    appCpuPctOfTotal: Number((appCpu / cores).toFixed(2)), dwmCpuPctOfOneCore: cpu.dwm ?? 0, gpu: {samples: 0, app3d: null}
  }, null, 2));
}

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

async function runOnce(hwdec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-bench-'));
  seed(dir, hwdec);
  // macOS: no window restoration, whose "reopen windows?" alert after an earlier crash would block the start
  const app = await _electron.launch({args: ['.', ...(process.platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : [])], cwd: REPO, env: {...process.env, YALL_MP_E2E: '1', YALL_MP_USER_DATA_DIR: dir}});
  try {
    const ui = await findUi(app);
    await ui.locator('#video-container .resizing-overlay').waitFor({state: 'detached', timeout: 30000});
    await ui.locator('.interaction-blocker').waitFor({state: 'detached', timeout: 30000}).catch(() => undefined);
    await app.evaluate((_e, size) => {
      const win = globalThis.__yallE2E.getWindows().mainWindow;
      const b = win.getBounds();
      win.setBounds({x: b.x, y: b.y, width: size.width, height: size.height});
    }, {width: WIDTH, height: HEIGHT});
    await sleep(800);
    await ui.evaluate(() => {
      window.__pb = null;
      window.electronAPI.onPlaybackStateUpdate(s => { window.__pb = s; });
    });
    await ui.bringToFront().catch(() => undefined);
    await ui.keyboard.press('Space');
    await sleep(2500);
    const state = await ui.evaluate(() => window.__pb);
    if (!state || !/Playing|Transitioning|AutoPaused/.test(state.playerState)) {
      throw new Error(`playback did not start: ${JSON.stringify(state)}`);
    }

    const out = path.join(dir, 'sampler.json');
    const sampling = process.platform === 'darwin' ? runPsSampler(app.process().pid, out) : runSampler(app.process().pid, out);
    await sleep((WARMUP + 1) * 1000);
    const before = await ui.evaluate(() => ({at: performance.now(), drawn: window.__yallVideoStats.drawn, received: window.__yallVideoStats.received}));
    await sleep(Math.max(5, MEASURE - 2) * 1000);
    const after = await ui.evaluate(() => ({at: performance.now(), drawn: window.__yallVideoStats.drawn, received: window.__yallVideoStats.received, stats: window.__yallVideoStats}));
    const mpv = await ui.evaluate(async () => ({
      drops: await window.electronAPI.mpvGetProperty('frame-drop-count').catch(() => null),
      delayed: await window.electronAPI.mpvGetProperty('vo-delayed-frame-count').catch(() => null),
      decoderDrops: await window.electronAPI.mpvGetProperty('decoder-frame-drop-count').catch(() => null),
      avsync: await window.electronAPI.mpvGetProperty('avsync').catch(() => null)
    }));
    const sender = await app.evaluate(() => globalThis.__yallE2E.getVideoStats());
    await sampling;
    const cpu = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, ''));
    const seconds = (after.at - before.at) / 1000;
    const fps = (after.drawn - before.drawn) / seconds;
    return {
      hwdec, backend: sender?.backend, fallbackReason: sender?.fallbackReason, adapter: sender?.addon?.adapter?.name,
      gpuWaitImpl: sender?.addon?.gpuWaitImpl, canvas: `${after.stats.canvasWidth}x${after.stats.canvasHeight}`,
      cpuPctOfOneCore: cpu.appCpuPctOfOneCore, byProcess: cpu.cpuPctOfOneCoreByProcess, dwmPctOfOneCore: cpu.dwmCpuPctOfOneCore,
      gpu3d: cpu.gpu.app3d, presentedFps: Number(fps.toFixed(1)), msPerFrame: Number(((cpu.appCpuPctOfOneCore / 100) / fps * 1000).toFixed(2)),
      dropped: after.stats.dropped, errors: after.stats.errors, sendFailures: sender?.sendFailures, inFlight: sender?.addon?.inFlight,
      reclaimed: sender?.addon?.reclaimed, mpv
    };
  } finally {
    await app.close().catch(() => undefined);
    await sleep(3000);
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

(async () => {
  const results = [];
  for (const hwdec of hwdecModes) {
    for (let run = 1; run <= RUNS; run++) {
      const result = await runOnce(hwdec);
      results.push(result);
      console.log(`hwdec=${hwdec} run ${run}/${RUNS}: ${result.cpuPctOfOneCore} % of one core, ${result.presentedFps} fps, ` +
        `${result.msPerFrame} ms/frame, backend ${result.backend}${result.fallbackReason ? ` (fallback: ${result.fallbackReason})` : ''}, ` +
        `mpv drops ${result.mpv.drops}/${result.mpv.delayed}, avsync ${result.mpv.avsync}`);
    }
  }
  for (const hwdec of hwdecModes) {
    const runs = results.filter(r => r.hwdec === hwdec);
    const mean = key => (runs.reduce((sum, r) => sum + r[key], 0) / runs.length).toFixed(2);
    console.log(`SUMMARY ${path.basename(file)} ${WIDTH}x${HEIGHT} hwdec=${hwdec}: ${mean('cpuPctOfOneCore')} % of one core, ${mean('msPerFrame')} ms/frame, ${mean('presentedFps')} fps`);
  }
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify({file: path.basename(file), size: `${WIDTH}x${HEIGHT}`, results}, null, 2));
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
