// Spike main process: one opaque window, libmpv rendering into shared D3D11 textures drawn onto a canvas.
const {app, BrowserWindow, ipcMain, sharedTexture} = require('electron');
const path = require('path');
const fs = require('fs');

const args = Object.fromEntries(process.argv.slice(1).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));

const cfg = {
  mode: args.mode || 'shared',            // shared | readback-ipc | readback-shm | legacy
  draw: args.draw || '2d',                // 2d | webgpu | webgl
  hwdec: args.hwdec || 'auto',
  file: args.file ? path.resolve(args.file) : path.join(__dirname, '..', '..', 'test', 'e2e', 'fixtures', 'sample.mp4'),
  slots: parseInt(args.slots || '3', 10),
  width: parseInt(args.width || '1600', 10),
  height: parseInt(args.height || '900', 10),
  resizeDebounce: parseInt(args['resize-debounce'] || '50', 10),
  duration: parseFloat(args.duration || '0'),   // seconds of wall time, 0 = run until closed
  probes: (args.probes || '').split(',').filter(Boolean).map(Number), // media seconds at which to screenshot
  out: args.out ? path.resolve(args.out) : path.join(__dirname, 'results'),
  loop: !!args.loop,
  subs: !!args.subs,                      // render the file's embedded subtitles in mpv (burned into the frame)
  adapter: args.adapter || 'gpu',         // gpu | warp
  stress: !!args.stress,
  quiet: !!args.quiet,
  benchOut: args['bench-out'] ? path.resolve(args['bench-out']) : null,   // write a JSON summary of the measurement window
  warmup: parseFloat(args.warmup || '10'),
  measure: parseFloat(args.measure || '60'),
  scripts: path.join(__dirname, '..', '..', 'mpv', 'yall_auto_pause.lua')
};

const log = (...a) => console.log(`[spike +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const t0 = Date.now();
fs.mkdirSync(cfg.out, {recursive: true});

const legacy = cfg.mode === 'legacy';
const addon = legacy ? null : require('./addon/build/Release/yall_libmpv_poc.node');
const net = require('net');
const {spawn} = require('child_process');
const legacyProps = {};
let legacyProc = null;
let videoWin = null;
let legacySock = null;
const LEGACY_PROPS = ['frame-drop-count', 'decoder-frame-drop-count', 'vo-delayed-frame-count', 'avsync', 'estimated-vf-fps', 'hwdec-current', 'time-pos'];

// Legacy: mpv.exe draws into this window with --wid, the app's flags, and is sampled over its JSON IPC pipe.
function startLegacy() {
  const pipe = '\\\\.\\pipe\\yall-bench-' + process.pid;
  // As in the app: mpv draws into its own frameless, click-through child window laid over the main window's content area.
  const cb = win.getContentBounds();
  videoWin = new BrowserWindow({
    parent: win, x: cb.x, y: cb.y, width: cb.width, height: cb.height, frame: false, transparent: true, focusable: false,
    skipTaskbar: true, resizable: false, show: true
  });
  videoWin.setIgnoreMouseEvents(true);
  const wid = videoWin.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const argv = ['--wid=' + wid, '--no-config', '--vo=gpu', '--hwdec=' + cfg.hwdec, '--no-osc', '--no-osd-bar', '--no-border',
    '--input-default-bindings=no', '--keep-open=always', '--idle=yes', '--hr-seek=default', '--hr-seek-framedrop=yes', '--cache=no',
    '--force-window=yes', '--vd-lavc-threads=0', '--demuxer-max-bytes=150MiB', '--demuxer-readahead-secs=20', '--framedrop=vo',
    '--vd-lavc-fast', '--sws-allow-zimg=no', '--sub-visibility=' + (cfg.subs ? 'yes' : 'no'), '--input-ipc-server=' + pipe, '--loop-file=inf', cfg.file];
  legacyProc = spawn(path.join(__dirname, 'vendor', 'mpv', 'mpv.exe'), process.env.LEGACY_LOG ? [...argv, '--msg-level=all=v'] : argv, {stdio: process.env.LEGACY_LOG ? ['ignore', fs.openSync(process.env.LEGACY_LOG, 'w'), 2] : 'ignore'});
  legacyProc.on('exit', c => log('legacy mpv exited', c));
  const tryConnect = () => {
    const sock = net.connect(pipe);
    sock.on('error', () => setTimeout(tryConnect, 200));
    sock.on('connect', () => { legacySock = sock; log('legacy ipc connected'); });
    let buf = '';
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.request_id >= 1000) legacyProps[LEGACY_PROPS[m.request_id - 1000]] = m.data;
        } catch {}
      }
    });
  };
  tryConnect();
  setInterval(() => {
    if (!legacySock) return;
    LEGACY_PROPS.forEach((p, i) => legacySock.write(JSON.stringify({command: ['get_property', p], request_id: 1000 + i}) + '\n'));
  }, 1000);
}

const getProp = p => legacy ? (legacyProps[p] ?? null) : addon.getProperty(p);
let win;
let attached = false;
let generation = 1;
let resizeTimer = null;
let rendererStats = {};
let sendFailures = 0;
let staleDropped = 0;
let sent = 0;
let lastGpuInfo = null;
const pendingProbes = [...cfg.probes];

function startMpv() {
  addon.loadMpv(path.join(__dirname, 'vendor', 'mpv-dev', 'libmpv-2.dll'));
  const opts = {
    vo: 'libmpv', hwdec: cfg.hwdec, 'load-scripts': 'yes', scripts: cfg.scripts,
    osc: 'no', 'osd-bar': 'no', 'input-default-bindings': 'no', 'keep-open': 'always', idle: 'yes',
    'hr-seek': 'default', 'hr-seek-framedrop': 'yes', cache: 'no', 'vd-lavc-threads': '0',
    'demuxer-max-bytes': '150MiB', 'demuxer-readahead-secs': '20', framedrop: 'vo', 'vd-lavc-fast': 'yes',
    'sws-allow-zimg': 'no', 'sub-visibility': cfg.subs ? 'yes' : 'no'
  };
  if (cfg.loop) opts['loop-file'] = 'inf';
  addon.create(opts);
  addon.observe('time-pos');
  addon.observe('eof-reached');
  addon.onEvent(e => {
    if (e.event === 'property-change' && e.name === 'time-pos') return;
    if (!cfg.quiet) log('mpv event', JSON.stringify(e));
  });
}

const readback = cfg.mode.startsWith('readback');
const shmName = `Local\\yall_poc_shm_${process.pid}`;

function onReadbackFrame(buf, w, h) {
  sent++;
  if (cfg.mode === 'readback-shm') win.webContents.send('shm-frame', buf.readUInt32LE(0));
  else win.webContents.send('frame', {w, h, buf});
}

function onFrame(slot, handleBuf, w, h, gen) {
  if (readback) return onReadbackFrame(handleBuf, w, h);
  // Frames rendered for an older size are still sent (drawn scaled): dropping them froze the picture
  // for seconds during a resize storm because frames take longer than a resize step.
  if (gen < generation) staleDropped++;
  let imported;
  try {
    imported = sharedTexture.importSharedTexture({
      textureInfo: {pixelFormat: 'bgra', codedSize: {width: w, height: h}, handle: {ntHandle: handleBuf}},
      allReferencesReleased: () => addon.releaseSlot(slot)
    });
  } catch (e) {
    sendFailures++;
    log('import failed', e.message);
    addon.releaseSlot(slot);
    return;
  }
  sent++;
  sharedTexture.sendSharedTexture({frame: win.webContents.mainFrame, importedSharedTexture: imported})
    .then(() => imported.release())
    .catch(e => {
      sendFailures++;
      if (sendFailures < 5) log('send failed', e.message);
      imported.release();
      addon.releaseSlot(slot);
    });
}

function attach(w, h) {
  const init = {width: w, height: h, slots: cfg.slots, warp: cfg.adapter === 'warp', readback};
  if (cfg.mode === 'readback-shm') init.shmName = shmName;
  const gpu = lastGpuInfo?.auxAttributes;
  const active = lastGpuInfo?.gpuDevice?.find(d => d.active);
  if (active?.luid) {
    init.luidLow = active.luid.low;
    init.luidHigh = active.luid.high;
  }
  const adapter = addon.attachRenderer(init, onFrame);
  log('renderer attached', w, h, 'adapter:', adapter, 'luid passed:', !!active?.luid, gpu ? '' : '');
  attached = true;
  addon.command(['loadfile', cfg.file, 'replace']);
  addon.setProperty('pause', 'no');
}

function onVideoSize(w, h) {
  if (!attached) return attach(w, h);
  clearTimeout(resizeTimer);
  const apply = () => {
    addon.resize(w, h);
    generation = addon.stats().generation;
  };
  if (cfg.resizeDebounce > 0) resizeTimer = setTimeout(apply, cfg.resizeDebounce);
  else apply();
}

async function sampleProbe() {
  if (!pendingProbes.length || !attached) return;
  const t = parseFloat(getProp('time-pos') || '0');
  if (t < pendingProbes[0]) return;
  const at = pendingProbes.shift();
  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  const px = (x, y) => {
    const i = (y * size.width + x) * 4;
    return [bmp[i + 2], bmp[i + 1], bmp[i]];
  };
  const centre = px(Math.floor(size.width / 2), Math.floor(size.height / 2));
  fs.writeFileSync(path.join(cfg.out, `probe-${cfg.mode}-${cfg.draw}-t${at}.png`), img.toPNG());
  log(`PROBE t=${at} (actual ${t.toFixed(2)}) centre rgb=${centre.join(',')} size=${size.width}x${size.height}`);
}

let stressTimer = null;
function runStress() {
  const sizes = [[800, 600], [1920, 1080], [1000, 700], [1600, 900], [1280, 720]];
  let i = 0;
  stressTimer = setInterval(() => {
    const [w, h] = sizes[(i++) % sizes.length];
    const jitter = i % 40;
    win.setContentSize(w + jitter, h + jitter);
    if (i >= 200) {
      clearInterval(stressTimer);
      log('stress loop finished');
    }
  }, 16);
}

let maxInFlight = 0;
let maxGap = 0;
function report() {
  const s = legacy ? {} : addon.stats();
  maxInFlight = Math.max(maxInFlight, s.inFlight || 0);
  if (Date.now() - t0 > 3000) maxGap = Math.max(maxGap, rendererStats.maxGapMs || 0);
  const props = ['frame-drop-count', 'decoder-frame-drop-count', 'vo-delayed-frame-count', 'avsync', 'estimated-vf-fps', 'hwdec-current', 'time-pos']
    .map(p => `${p}=${getProp(p)}`).join(' ');
  log('STATS', JSON.stringify({sent, sendFailures, staleDropped, addon: s, renderer: rendererStats}), props);
}

// Bench: sample once per second after the warm-up; the summary is written when the measurement window ends.
const benchSamples = [];
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function benchSample() {
  const s = legacy ? {} : addon.stats();
  benchSamples.push({
    t: (Date.now() - t0) / 1000,
    timePos: num(getProp('time-pos')),
    frameDrop: num(getProp('frame-drop-count')), decoderDrop: num(getProp('decoder-frame-drop-count')),
    voDelayed: num(getProp('vo-delayed-frame-count')), avsync: num(getProp('avsync')), vfFps: num(getProp('estimated-vf-fps')),
    hwdec: getProp('hwdec-current'),
    addon: s, renderer: {...rendererStats}, sent, sendFailures
  });
}
function benchSummary() {
  const first = benchSamples[0];
  const last = benchSamples[benchSamples.length - 1];
  const delta = k => (first && last && first[k] !== null && last[k] !== null ? last[k] - first[k] : null);
  const rd = k => (first && last ? (last.renderer[k] || 0) - (first.renderer[k] || 0) : null);
  const av = benchSamples.map(x => x.avsync).filter(x => x !== null).map(Math.abs);
  const fps = benchSamples.map(x => x.renderer.fps).filter(x => x !== undefined);
  const wall = last && first ? last.t - first.t : 0;
  const media = delta('timePos');
  const vfFps = last ? last.vfFps : null;
  return {
    config: {mode: cfg.mode, draw: cfg.draw, hwdec: cfg.hwdec, file: path.basename(cfg.file), slots: cfg.slots, adapter: cfg.adapter},
    samples: benchSamples.length, wallSec: wall, mediaSec: media, hwdecCurrent: last ? last.hwdec : null, vfFps,
    expectedFrames: media !== null && vfFps ? media * vfFps : null,
    frameDrop: delta('frameDrop'), decoderDrop: delta('decoderDrop'), voDelayed: delta('voDelayed'),
    avsyncMeanAbs: av.length ? av.reduce((a, b) => a + b, 0) / av.length : null, avsyncMaxAbs: av.length ? Math.max(...av) : null,
    drawnFps: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : null,
    drawnFpsMin: fps.length ? Math.min(...fps) : null,
    rendererDropped: rd('rendererDropped'), longTasks: rd('longTasks'), longTaskMs: rd('longTaskMs'),
    maxGapMs: Math.max(0, ...benchSamples.map(x => x.renderer.maxGapMs || 0)),
    sendFailures: last ? last.sendFailures - first.sendFailures : null,
    poolExhausted: last && last.addon.exhausted !== undefined ? last.addon.exhausted - first.addon.exhausted : null,
    inFlightEnd: last ? last.addon.inFlight : null,
    addonLast: last ? last.addon : null
  };
}
function startBench() {
  setTimeout(() => {
    log('bench: measurement window started');
    benchSample();
    const timer = setInterval(benchSample, 1000);
    setTimeout(() => {
      clearInterval(timer);
      benchSample();
      fs.writeFileSync(cfg.benchOut, JSON.stringify(benchSummary(), null, 2));
      log('bench: summary written', cfg.benchOut);
      app.quit();
    }, cfg.measure * 1000);
  }, cfg.warmup * 1000);
}

app.commandLine.appendSwitch('enable-unsafe-webgpu');

app.whenReady().then(async () => {
  lastGpuInfo = await app.getGPUInfo('complete').catch(() => null);
  fs.writeFileSync(path.join(cfg.out, 'gpuinfo.json'), JSON.stringify(lastGpuInfo, null, 2));
  log('gpuinfo devices:', JSON.stringify(lastGpuInfo?.gpuDevice));

  if (!legacy) startMpv();

  win = new BrowserWindow({
    width: cfg.width, height: cfg.height, useContentSize: true, backgroundColor: '#000000', show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--spike-draw=${cfg.draw}`, `--spike-mode=${cfg.mode}`, `--spike-shm=${shmName}`],
      sandbox: cfg.mode !== 'readback-shm', contextIsolation: true
    }
  });
  win.removeMenu();
  if (legacy) startLegacy();
  else win.loadFile('index.html');

  ipcMain.on('video-size', (_e, w, h) => onVideoSize(w, h));
  ipcMain.on('renderer-stats', (_e, s) => { rendererStats = s; });
  ipcMain.on('renderer-log', (_e, m) => log('renderer:', m));

  win.webContents.on('did-finish-load', () => {
    if (cfg.stress) setTimeout(runStress, 4000);
  });

  setInterval(() => sampleProbe().catch(e => log('probe error', e.message)), 100);
  if (!cfg.quiet) setInterval(report, 1000);
  if (cfg.benchOut) startBench();
  if (cfg.duration > 0) setTimeout(() => app.quit(), cfg.duration * 1000);
  win.on('closed', () => app.quit());
});

app.on('will-quit', () => {
  const s = legacy ? {} : addon.stats();
  if (legacyProc) legacyProc.kill();
  log('FINAL', JSON.stringify({sent, sendFailures, staleDropped, maxInFlight, maxGapMs: maxGap, addon: s, renderer: rendererStats}));
  try {
    if (!legacy) addon.destroy();
  } catch (e) {
    console.error('destroy failed', e);
  }
});
