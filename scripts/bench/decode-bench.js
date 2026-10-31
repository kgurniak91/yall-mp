// Decode-only comparison of the bundled libmpv with a plain mpv.exe, with the options the app uses and no video output.
// Run with the app's own runtime, no window needed:
//   set ELECTRON_RUN_AS_NODE=1
//   "<win-unpacked>\Y'ALL Media Player.exe" decode-bench.js <win-unpacked> <media> [hwdec=no] [mode=timed|untimed] [seconds=40] [attach=none|d3d11-shared|readback]
// Prints one JSON line (or writes it to the file named by DECODE_OUT, the app exe has no console): CPU seconds of the whole process over the wall time of the playback.
const fs = require('fs');
const path = require('path');

const [, , appDir, media, hwdec = 'no', mode = 'timed', secondsArg = '40', attach = 'none'] = process.argv;
const seconds = Number(secondsArg);
const resources = path.join(appDir, 'resources');

const findFile = (dir, name) => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
};

(async () => {
  const bridge = require(path.join(resources, 'app.asar', 'libmpv-bridge.js'));
  const addonPath = findFile(path.join(resources, 'app.asar.unpacked'), 'yall_libmpv.node');
  const addon = bridge.loadLibmpvAddon({addonPath, appRoot: path.join(resources, 'app.asar')});
  const libPath = path.join(resources, 'electron-resources', 'windows', 'libmpv-2.dll');
  const loaded = bridge.loadLibmpv(addon, [libPath]);

  const options = {
    vo: attach === 'none' ? 'null' : 'libmpv', ao: 'null', hwdec, osc: 'no', 'input-default-bindings': 'no', 'keep-open': 'no', idle: 'yes',
    'sub-visibility': 'no', 'hr-seek': 'default', 'hr-seek-framedrop': 'yes', cache: 'no', 'vd-lavc-threads': '0',
    'demuxer-max-bytes': '150MiB', 'demuxer-readahead-secs': '20', framedrop: 'vo', 'vd-lavc-fast': 'yes',
    'sws-allow-zimg': 'no', 'load-scripts': 'no', config: 'no'
  };
  // Extra options as name=value pairs separated by ';' (to add what the app has, one thing at a time)
  for (const pair of (process.env.DECODE_EXTRA || '').split(';').filter(Boolean)) {
    const at = pair.indexOf('=');
    options[pair.slice(0, at)] = pair.slice(at + 1);
  }
  if (mode === 'untimed') {
    options.untimed = 'yes';
    options['ao-null-untimed'] = 'yes';
  }
  const mpv = await bridge.Libmpv.create(addon, {options, apiVersion: loaded.apiVersion, libraryPath: loaded.path});

  // The addon's event callback does not keep the process alive; the timeout also ends a stuck run
  const keepAlive = setInterval(() => {}, 1000);
  let frames = 0;
  if (attach !== 'none') {
    // Presents like the app does, to the extent that every frame is handed back at once (no Chromium behind it)
    await mpv.attachRenderer({backend: attach, width: 2400, height: 1078}, frame => {
      frames++;
      if (frame.slotId >= 0) mpv.releaseSlot(frame.attachId, frame.slotId, frame.serial);
    });
  }
  // Seeks like the app's clip changes: every DECODE_SEEK_EVERY seconds an absolute seek DECODE_SEEK_DELTA seconds ahead
  let seeks = 0;
  const seekEvery = Number(process.env.DECODE_SEEK_EVERY || 0);
  const seekDelta = Number(process.env.DECODE_SEEK_DELTA || 0.01);
  const seekTimer = seekEvery > 0 ? setInterval(async () => {
    try {
      const position = Number(await mpv.getProperty('time-pos'));
      if (Number.isFinite(position)) {
        seeks++;
        await mpv.command(['seek', String(position + seekDelta), 'absolute']);
      }
    } catch { /* between files */ }
  }, seekEvery * 1000) : null;
  const done = new Promise((resolve, reject) => {
    mpv.on('end-file', resolve);
    setTimeout(() => reject(new Error('timeout waiting for end-file')), (seconds + 60) * 1000);
  });
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  await mpv.command(['loadfile', media, 'replace', 0, `start=${process.env.DECODE_START || 5},length=${seconds}`]);
  await done;
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  let version = '';
  try { version = String(await mpv.getProperty('mpv-version')); } catch { /* optional */ }
  const line = JSON.stringify({
    start: Number(process.env.DECODE_START || 5), extra: process.env.DECODE_EXTRA || '', seeks, engine: attach === 'none' ? 'libmpv' : 'libmpv+' + attach, frames, mode, hwdec, seconds, wallMs: Math.round(wallMs), cpuMs: Math.round(cpuMs),
    cpuPctOfOneCore: +(cpuMs / wallMs * 100).toFixed(1), version, lib: loaded.path
  });
  if (process.env.DECODE_OUT) fs.writeFileSync(process.env.DECODE_OUT, line); else console.log(line);
  clearInterval(keepAlive);
  if (seekTimer) clearInterval(seekTimer);
  process.exit(0);
})().catch(error => {
  const text = 'FAILED ' + (error && error.stack || error);
  if (process.env.DECODE_OUT) fs.writeFileSync(process.env.DECODE_OUT, text); else console.error(text);
  process.exit(2);
});
