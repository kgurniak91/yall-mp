// Electron smoke harness for the libmpv render path: one sandboxed window, the compiled libmpv-bridge and
// libmpv-frame-sender, frames counted in the preload. Prints a summary, optionally writes JSON, and exits non-zero
// when a check fails.
//
//   npm run test:native:smoke -- --backend=auto --seconds=12 --json=out.json
//
// --backend=d3d11-shared|readback|auto   (default auto)
// --adapter=gpu|default|warp             gpu = the active GPU from getGPUInfo (default)
// --file=<path> | --clip=<WxH>@<fps>     media (default test/e2e/fixtures/sample.mp4); clips are generated on demand
// --seconds=N  --warmup=N  --width=N --height=N  --hwdec=auto|no  --ao=<driver>  --subs  --simulate-import-failure
// --opts=a=b,c=d                        extra mpv options (bisecting)
// --stop-after-create                    exit 0 once the mpv core was created
// --min-fps=N                            override the minimum received frame rate
const {app, BrowserWindow, ipcMain} = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const {loadLibmpvAddon, loadLibmpv, libmpvCandidates, Libmpv} = require(path.join(ROOT, 'libmpv-bridge.js'));
const {LibmpvFrameSender} = require(path.join(ROOT, 'libmpv-frame-sender.js'));

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));

const t0 = Date.now();
const log = (...a) => console.log(`[smoke +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const cfg = {
  backend: args.backend || 'auto',
  adapter: args.adapter || 'gpu',
  hwdec: args.hwdec || 'auto',
  ao: args.ao || null,
  seconds: parseFloat(args.seconds || '12'),
  warmup: parseFloat(args.warmup || '3'),
  width: parseInt(args.width || '1600', 10),
  height: parseInt(args.height || '900', 10),
  subs: !!args.subs,
  opts: typeof args.opts === 'string' ? args.opts.split(',').filter(Boolean) : [],
  stopAfterCreate: !!args['stop-after-create'],
  simulateImportFailure: !!args['simulate-import-failure'],
  minFps: args['min-fps'] ? parseFloat(args['min-fps']) : null,
  json: args.json ? path.resolve(args.json) : null,
  file: path.join(ROOT, 'test', 'e2e', 'fixtures', 'sample.mp4')
};
if (args.file) {
  cfg.file = path.resolve(args.file);
} else if (args.clip) {
  const [size, fps] = String(args.clip).split('@');
  cfg.file = require(path.join(ROOT, 'test', 'native', 'support', 'bench-media.js')).ensureClip({size, fps: fps ? Number(fps) : 30, seconds: 30});
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({name, ok: !!ok, detail});
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${detail})`}`);
};

let win;
let libmpv;
let sender;
let rendererStats = {};
let started = false;
const logLines = [];
const senderLog = message => {
  logLines.push(message);
  log(message);
};

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const received = () => (rendererStats.shared || 0) + (rendererStats.readback || 0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function begin(width, height, gpuInfo) {
  const addon = loadLibmpvAddon({appRoot: ROOT});
  const loaded = loadLibmpv(addon, libmpvCandidates({basePath: ROOT, customPath: process.env.YALL_LIBMPV_PATH || undefined}));
  log(`libmpv ${loaded.path} client API ${loaded.apiVersion.join('.')}`);
  const options = {
    vo: 'libmpv', hwdec: cfg.hwdec, 'load-scripts': 'yes', scripts: path.join(ROOT, 'mpv', 'yall_auto_pause.lua'),
    osc: 'no', 'osd-bar': 'no', 'input-default-bindings': 'no', 'keep-open': 'always', idle: 'yes',
    'hr-seek': 'default', 'hr-seek-framedrop': 'yes', cache: 'no', 'vd-lavc-threads': '0',
    'demuxer-max-bytes': '150MiB', 'demuxer-readahead-secs': '20', framedrop: 'vo', 'vd-lavc-fast': 'yes',
    'sws-allow-zimg': 'no', 'sub-visibility': cfg.subs ? 'yes' : 'no'
  };
  if (cfg.ao) {
    options.ao = cfg.ao;
  }
  for (const pair of cfg.opts) {
    const [k, ...v] = pair.split('=');
    options[k] = v.join('=');
  }
  log('creating the mpv core');
  libmpv = Libmpv.create(addon, {options, apiVersion: loaded.apiVersion});
  log('mpv core created');
  if (cfg.stopAfterCreate) {
    await libmpv.destroy();
    app.exit(0);
    await new Promise(() => {}); // app.exit ends the process
  }
  libmpv.on('end-file', e => log('end-file', JSON.stringify(e)));
  // mpv's own warnings and errors (VO/render failures are otherwise just an error code)
  libmpv.on('event', e => {
    if (e.event === 'log-message') {
      log(`mpv[${e.prefix}] ${e.level}: ${String(e.text).trim()}`);
    }
  });
  libmpv.requestLogMessages('warn');

  const adapter = cfg.adapter === 'gpu' ? undefined : cfg.adapter;
  sender = new LibmpvFrameSender({
    libmpv, webContents: win.webContents, gpuInfo, log: senderLog, adapter, simulateImportFailure: cfg.simulateImportFailure
  });
  const attach = sender.start({width, height, preferred: cfg.backend});
  log('attached', JSON.stringify(attach));
  // The renderer is attached before the file is loaded: a render context freed later would take the VO with it.
  await libmpv.command(['loadfile', cfg.file, 'replace']);
  await libmpv.setProperty('pause', false);
  return {loaded, attach};
}

async function sample() {
  const [timePos, vfFps] = await Promise.all([
    libmpv.getProperty('time-pos').catch(() => null),
    libmpv.getProperty('estimated-vf-fps').catch(() => null)
  ]);
  return {at: Date.now(), timePos: num(timePos), vfFps: num(vfFps), received: received(), addon: sender.stats().addon};
}

async function run(gpuInfo) {
  const {loaded, attach} = await begin(win.getContentSize()[0], win.getContentSize()[1], gpuInfo);

  const firstFrameBy = Date.now() + 20000;
  while (received() === 0 && Date.now() < firstFrameBy) {
    await sleep(100);
  }
  check('first frame received within 20 s', received() > 0, `${received()} frames`);

  await sleep(cfg.warmup * 1000);
  const a = await sample();
  await sleep(cfg.seconds * 1000);
  const b = await sample();

  const wallSec = (b.at - a.at) / 1000;
  const mediaSec = a.timePos !== null && b.timePos !== null ? b.timePos - a.timePos : null;
  const vfFps = b.vfFps;
  const expected = mediaSec !== null && vfFps ? mediaSec * vfFps : null;
  const frames = b.received - a.received;
  const fps = frames / wallSec;
  const fs_ = sender.stats();
  const backend = fs_.backend;
  const wasShared = backend === 'd3d11-shared';

  const addonA = a.addon;
  const addonB = b.addon;
  const cpu = addonA && addonB && addonA.attachId === addonB.attachId ? {
    wallMs: addonB.threadWallMs - addonA.threadWallMs,
    threadMs: addonB.threadCpuMs - addonA.threadCpuMs,
    renderMs: addonB.renderCpuMs - addonA.renderCpuMs,
    waitMs: addonB.waitCpuMs - addonA.waitCpuMs
  } : null;
  const pct = ms => (cpu && cpu.wallMs > 0 ? (ms / cpu.wallMs) * 100 : null);
  const summary = {
    config: {...cfg, file: path.basename(cfg.file)},
    libmpv: loaded, attach, backend, fallbackReason: fs_.fallbackReason,
    window: {wallSec, mediaSec, vfFps, expectedFrames: expected, frames, fps, ratio: expected ? frames / expected : null},
    renderThreadCpuPct: {total: pct(cpu?.threadMs), render: pct(cpu?.renderMs), wait: pct(cpu?.waitMs)},
    sender: {...fs_, addon: undefined},
    addon: addonB,
    renderer: rendererStats,
    centre: rendererStats.centre
  };

  // ---- checks ----
  check('frames received during the window', frames > 0, `${frames} in ${wallSec.toFixed(1)} s = ${fps.toFixed(1)} fps`);
  check('media time advanced', mediaSec !== null && mediaSec > wallSec * 0.8, `${mediaSec?.toFixed(2)} s of media`);
  if (cfg.simulateImportFailure) {
    check('import failure switched to readback', fs_.fallbackReason !== null && backend === 'readback', fs_.fallbackReason);
    check('fallback logged', logLines.some(l => /shared-texture import failed on first frame .*switching to readback/.test(l)));
    check('readback frames keep arriving after the fallback', (rendererStats.readback || 0) > 0 && frames > 0);
  } else {
    // A real first-frame import failure (no usable GPU) legitimately switches to readback: that is the intended fallback.
    check('no import failures, or a clean switch to readback', fs_.importFailures === 0 || (fs_.fallbackReason !== null && backend === 'readback'),
      `${fs_.importFailures}${fs_.fallbackReason ? `, fallback: ${fs_.fallbackReason}` : ''}`);
    check('no send failures', fs_.sendFailures === 0, `${fs_.sendFailures}`);
    if (cfg.backend === 'd3d11-shared') {
      check('shared backend kept (no fallback)', wasShared, fs_.fallbackReason ?? '');
    }
  }
  const minFps = cfg.minFps ?? (wasShared && expected ? null : Math.min(24, (vfFps || 24) * 0.95));
  if (minFps !== null) {
    check(`received fps >= ${minFps.toFixed(1)}`, fps >= minFps, `${fps.toFixed(1)} fps at ${rendererStats.lastWidth}x${rendererStats.lastHeight}`);
  } else {
    check('received >= 95 % of the expected frames', expected && frames >= expected * 0.95, `${frames} / ${expected?.toFixed(0)}`);
  }
  if (wasShared) {
    const total = summary.renderThreadCpuPct.total;
    check('render thread < 1 % of one core', total !== null && total < 1,
      `total ${total?.toFixed(2)} % = render ${summary.renderThreadCpuPct.render?.toFixed(2)} + wait ${summary.renderThreadCpuPct.wait?.toFixed(2)}; gpuWaitImpl=${attach.gpuWaitImpl}`);
  }

  // ---- shutdown, the way a user does it: close the window ----
  const closeAt = Date.now();
  const closed = new Promise(resolve => app.once('window-all-closed', resolve));
  win.close();
  await closed;
  await shutdown();
  const shutdownMs = Date.now() - closeAt;
  const counts = loadLibmpvAddon({appRoot: ROOT}).liveCounts();
  summary.shutdownMs = shutdownMs;
  summary.liveCountsAfter = counts;
  check('live counts zero after shutdown', Object.values(counts).every(v => v === 0), JSON.stringify(counts));
  check('shutdown < 3 s', shutdownMs < 3000, `${shutdownMs} ms`);
  check('no "Unable to duplicate handle" logged', !logLines.some(l => /duplicate handle/i.test(l)));

  summary.checks = checks;
  summary.passed = checks.every(c => c.ok);
  return summary;
}

async function shutdown() {
  sender?.stop();
  await libmpv?.destroy().catch(e => log('destroy failed', e.message));
  const addonModule = loadLibmpvAddon({appRoot: ROOT});
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && Object.values(addonModule.liveCounts()).some(v => v !== 0)) {
    await sleep(50);
  }
}

app.whenReady().then(async () => {
  const gpuInfo = await app.getGPUInfo('complete').catch(() => null);
  log('gpu devices', JSON.stringify(gpuInfo?.gpuDevice?.map(d => ({v: d.vendorId, d: d.deviceId, active: d.active}))));

  win = new BrowserWindow({
    width: cfg.width, height: cfg.height, useContentSize: true, backgroundColor: '#000000', show: true,
    webPreferences: {preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true}
  });
  win.removeMenu();
  win.on('close', () => sender?.stop());
  ipcMain.on('smoke:stats', (_e, s) => { rendererStats = s; });
  ipcMain.once('smoke:video-size', () => {
    if (started) {
      return;
    }
    started = true;
    run(gpuInfo).then(summary => finish(summary), error => {
      console.error(error);
      finish({passed: false, error: String(error?.stack || error), checks});
    });
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
});

function finish(summary) {
  if (cfg.json) {
    fs.mkdirSync(path.dirname(cfg.json), {recursive: true});
    fs.writeFileSync(cfg.json, JSON.stringify(summary, null, 2));
  }
  const failed = checks.filter(c => !c.ok);
  log(summary.passed ? 'SMOKE PASSED' : `SMOKE FAILED: ${failed.map(c => c.name).join('; ') || summary.error}`);
  app.exit(summary.passed ? 0 : 1);
}

setTimeout(() => {
  console.error('smoke: global timeout');
  app.exit(2);
}, (cfg.seconds + cfg.warmup + 60) * 1000);
