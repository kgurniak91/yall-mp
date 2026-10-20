// Prints which ffmpeg/libmpv libraries end up in the process and whether mpv_initialize survives.
// Runs under plain node, `ELECTRON_RUN_AS_NODE=1 electron`, or as an Electron main script:
//
//   node test/native/support/ffmpeg-scope-probe.js
//   ELECTRON_RUN_AS_NODE=1 npx electron test/native/support/ffmpeg-scope-probe.js
//   npx electron test/native/support/ffmpeg-scope-probe.js
//
// Linux only (reads /proc/self/maps). An `exit(1)` inside mpv_initialize shows up as the exit code.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const {loadLibmpvAddon, loadLibmpv, libmpvCandidates, Libmpv} = require(path.join(ROOT, 'libmpv-bridge.js'));

// Under ELECTRON_RUN_AS_NODE require('electron') is just the binary path, so only the real main process gets the API.
const electron = process.type === 'browser' ? require('electron') : null;
const mode = !process.versions.electron ? 'node'
  : (process.type === 'browser' ? 'electron-main' : 'electron-run-as-node');

const say = (...a) => console.log('[probe]', ...a);

const maps = label => {
  const counts = new Map();
  for (const line of fs.readFileSync('/proc/self/maps', 'utf8').split('\n')) {
    const cols = line.trim().split(/\s+/);
    const file = cols[5];
    if (!file || !/ffmpeg|libav(codec|format|util)|libsw(scale|resample)|libmpv|libc\.so/.test(file)) {
      continue;
    }
    if (cols[2] === '00000000') {
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  }
  say(`maps ${label}:`);
  for (const [file, n] of counts) {
    say(`  ${file} x${n}`);
  }
  if (!counts.size) {
    say('  (no matching libraries)');
  }
};

async function main() {
  say(`mode=${mode} dlmopen=${process.env.YALL_LIBMPV_DLMOPEN === '1'} electron=${process.versions.electron || '-'}`);
  maps('before loading the addon');
  const addon = loadLibmpvAddon({appRoot: ROOT});
  const loaded = loadLibmpv(addon, libmpvCandidates({basePath: ROOT, customPath: process.env.YALL_LIBMPV_PATH || undefined}));
  say(`libmpv ${loaded.path} client API ${loaded.apiVersion.join('.')}`);
  maps('after loading libmpv');
  const libmpv = Libmpv.create(addon, {
    options: {vo: 'null', ao: 'null', terminal: 'yes', 'msg-level': 'all=warn'},
    apiVersion: loaded.apiVersion
  });
  say('core initialized');
  maps('after mpv_initialize');
  await libmpv.destroy();
  say('destroyed');
}

const finish = code => (electron ? electron.app.exit(code) : process.exit(code));

const start = () => main().then(() => finish(0), error => {
  console.error('[probe] failed:', error && error.stack || error);
  finish(1);
});

if (electron) {
  electron.app.whenReady().then(start);
} else {
  start();
}
