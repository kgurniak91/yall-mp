// Builds the macOS native add-on (native/mpv-embed) against Electron's headers.
//
// Usage:
//   node scripts/build-native.js            # fails loudly when the build fails
//   node scripts/build-native.js --optional # postinstall: warn and continue instead
//
// Does nothing on Windows and Linux, where the app keeps using a separate mpv
// process with `--wid` window embedding.

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const optional = process.argv.includes('--optional');
const root = path.join(__dirname, '..');
const addonDir = path.join(root, 'native', 'mpv-embed');
const output = path.join(addonDir, 'build', 'Release', 'yall_mpv_embed.node');

if (process.platform !== 'darwin') {
  console.log('[build-native] Not macOS, nothing to build.');
  process.exit(0);
}

let electronVersion;
try {
  electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
} catch (e) {
  fail('Electron is not installed (node_modules/electron missing). Run `npm install` first.');
}

const nodeGyp = path.join(root, 'node_modules', '.bin', 'node-gyp');
if (!fs.existsSync(nodeGyp)) {
  fail('node-gyp is not installed. Run `npm install` first.');
}

console.log(`[build-native] Building native/mpv-embed for Electron ${electronVersion} (${process.arch})...`);

const result = spawnSync(nodeGyp, [
  'rebuild',
  `--target=${electronVersion}`,
  '--runtime=electron',
  '--dist-url=https://electronjs.org/headers',
  `--arch=${process.arch}`
], {
  cwd: addonDir,
  stdio: 'inherit',
  env: {...process.env, npm_config_loglevel: 'error'}
});

if (result.status !== 0 || !fs.existsSync(output)) {
  fail(
    'Building the macOS video add-on failed. Xcode Command Line Tools are required ' +
    '(`xcode-select --install`). The app cannot show video on macOS without it.'
  );
}

console.log(`[build-native] Built ${path.relative(root, output)}`);

function fail(message) {
  if (optional) {
    console.warn(`[build-native] WARNING: ${message}`);
    process.exit(0);
  }
  console.error(`[build-native] ERROR: ${message}`);
  process.exit(1);
}
