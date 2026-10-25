// Builds dist_electron/bench-kit.zip for the old-laptop benchmark: the unpacked Windows build, the bench scripts and
// the repo's 1080p fixtures. Run `npm run package:win` first.
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const REPO = path.resolve(__dirname, '..');
const unpacked = path.join(REPO, 'dist_electron', 'win-unpacked');
const staging = path.join(REPO, 'dist_electron', 'bench-kit');
const zip = path.join(REPO, 'dist_electron', 'bench-kit.zip');

if (process.platform !== 'win32') {
  console.error('The bench kit is for Windows.');
  process.exit(1);
}
if (!fs.existsSync(unpacked)) {
  console.error(`Missing ${unpacked}; run "npm run package:win" first.`);
  process.exit(1);
}

fs.rmSync(staging, {recursive: true, force: true});
fs.rmSync(zip, {force: true});
fs.mkdirSync(path.join(staging, 'media'), {recursive: true});
fs.cpSync(unpacked, path.join(staging, 'win-unpacked'), {recursive: true});
fs.cpSync(path.join(REPO, 'scripts', 'bench'), path.join(staging, 'bench'), {
  recursive: true,
  filter: source => !source.includes(`${path.sep}results`)
});
for (const name of ['1080p30-h264.mp4', '1080p60-h264.mp4']) {
  const source = path.join(REPO, 'spikes', 'libmpv-poc', 'media', name);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(staging, 'media', name));
  } else {
    console.warn(`Fixture not found, skipped: ${source}`);
  }
}

const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${staging}\*' -DestinationPath '${zip}'`], {stdio: 'inherit'});
fs.rmSync(staging, {recursive: true, force: true});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`Written ${zip}`);
