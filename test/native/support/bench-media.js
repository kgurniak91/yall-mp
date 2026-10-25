// Generates large test clips with ffmpeg-static into test-results/native-media/ (gitignored, never committed).
// testsrc2 + noise keeps the encoder busy enough to look like real content.
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const ffmpeg = require('ffmpeg-static');

const OUT = path.join(__dirname, '..', '..', '..', 'test-results', 'native-media');

/** Returns the path of a h264 clip, encoding it on first use. */
function ensureClip({size = '1920x1080', fps = 30, seconds = 20, bitrate = '8M'} = {}) {
  const name = `${size}-${fps}fps-${seconds}s.mp4`;
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e5) return dest;
  fs.mkdirSync(OUT, {recursive: true});
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}:duration=${seconds},noise=alls=20:allf=t+u`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', '16M',
    '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-c:a', 'aac', '-b:a', '128k', '-shortest', dest];
  const result = spawnSync(ffmpeg, args, {stdio: 'inherit'});
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}) while generating ${name}`);
  }
  return dest;
}

/**
 * Returns the path of a short clip whose top half is pure red and bottom half pure blue, for orientation checks
 * of GPU render targets (a flipped picture swaps the halves).
 */
function ensureSplitClip({width = 320, height = 180, fps = 25, seconds = 4} = {}) {
  const name = `split-red-blue-${width}x${height}-${fps}fps-${seconds}s.mp4`;
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e3) return dest;
  fs.mkdirSync(OUT, {recursive: true});
  const half = height / 2;
  const graph = `color=c=red:s=${width}x${half}:r=${fps}:d=${seconds}[t];` +
    `color=c=blue:s=${width}x${half}:r=${fps}:d=${seconds}[b];[t][b]vstack`;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-filter_complex', graph,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-t', String(seconds), dest];
  const result = spawnSync(ffmpeg, args, {stdio: 'inherit'});
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}) while generating ${name}`);
  }
  return dest;
}

module.exports = {ensureClip, ensureSplitClip};

if (require.main === module) {
  const [size, fps, seconds] = process.argv.slice(2);
  console.log(ensureClip({size, fps: fps ? Number(fps) : undefined, seconds: seconds ? Number(seconds) : undefined}));
}
