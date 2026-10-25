// Builds dist_electron/bench-kit.zip for the old-laptop benchmark: the unpacked Windows build, the bench scripts and
// a few short media clips cut from the local test media in spikes/libmpv-poc/media (not in the repo). Run
// `npm run package:win` first.
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const REPO = path.resolve(__dirname, '..');
const unpacked = path.join(REPO, 'dist_electron', 'win-unpacked');
const staging = path.join(REPO, 'dist_electron', 'bench-kit');
const zip = path.join(REPO, 'dist_electron', 'bench-kit.zip');
const sourceDir = path.join(REPO, 'spikes', 'libmpv-poc', 'media');
const ffmpeg = require('ffmpeg-static');

if (process.platform !== 'win32') {
  console.error('The bench kit is for Windows.');
  process.exit(1);
}
if (!fs.existsSync(unpacked)) {
  console.error(`Missing ${unpacked}; run "npm run package:win" first.`);
  process.exit(1);
}

function cut(sourceName, targetName, ffmpegArgs) {
  const source = path.join(sourceDir, sourceName);
  if (!fs.existsSync(source)) {
    console.error(`Missing test media: ${source}`);
    process.exit(1);
  }
  const target = path.join(staging, 'media', targetName);
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', '120', '-i', source, '-t', '120', ...ffmpegArgs, target], {stdio: 'inherit'});
  if (result.status !== 0) {
    console.error(`ffmpeg failed for ${targetName}`);
    process.exit(1);
  }
  console.log(`${targetName}: ${(fs.statSync(target).size / 1e6).toFixed(0)} MB`);
}

fs.rmSync(staging, {recursive: true, force: true});
fs.rmSync(zip, {force: true});
fs.mkdirSync(path.join(staging, 'media'), {recursive: true});
fs.cpSync(unpacked, path.join(staging, 'win-unpacked'), {recursive: true});
fs.cpSync(path.join(REPO, 'scripts', 'bench'), path.join(staging, 'bench'), {
  recursive: true,
  filter: source => !source.includes(`${path.sep}results`) && !source.endsWith('bench-results.zip')
});

// Two minutes of the Hi10P episode (embedded ASS + fonts): as is, and as an ordinary 8-bit 1080p h264 that every GPU can decode in hardware
cut('real-railgun.mkv', 'episode-hi10p-ass.mkv', ['-map', '0', '-c', 'copy']);
cut('real-railgun.mkv', 'episode-1080p-ass.mkv', ['-map', '0', '-c', 'copy', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']);
const fixture = path.join(sourceDir, '1080p60-h264.mp4');
if (fs.existsSync(fixture)) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', fixture, '-t', '75', '-c', 'copy', path.join(staging, 'media', '1080p60-h264.mp4')], {stdio: 'inherit'});
  if (result.status !== 0) {
    process.exit(1);
  }
} else {
  console.error(`Missing test media: ${fixture}`);
  process.exit(1);
}

const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${staging}\*' -DestinationPath '${zip}'`], {stdio: 'inherit'});
fs.rmSync(staging, {recursive: true, force: true});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`Written ${zip} (${(fs.statSync(zip).size / 1e6).toFixed(0)} MB)`);
