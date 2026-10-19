// Generates the benchmark media into media/ (gitignored): 90 s of testsrc2 + noise + a tone.
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const ffmpeg = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ffmpeg-static'));

const OUT = path.join(__dirname, '..', 'media');
const DURATION = 90;
fs.mkdirSync(OUT, {recursive: true});

const src = (size, fps) => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}:duration=${DURATION},noise=alls=20:allf=t+u`,
  '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${DURATION}`];
const audio = ['-c:a', 'aac', '-b:a', '128k', '-shortest'];

const jobs = [
  {
    name: '1080p30-h264.mp4',
    variants: [[...src('1920x1080', 30), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M',
      '-pix_fmt', 'yuv420p', '-g', '60', ...audio]]
  },
  {
    name: '1080p60-h264.mp4',
    variants: [[...src('1920x1080', 60), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '12M', '-maxrate', '15M', '-bufsize', '24M',
      '-pix_fmt', 'yuv420p', '-g', '120', ...audio]]
  },
  {
    name: '2160p24-hevc10.mkv',
    variants: [
      [...src('3840x2160', 24), '-c:v', 'hevc_nvenc', '-profile:v', 'main10', '-pix_fmt', 'p010le', '-b:v', '25M', '-g', '48', ...audio],
      [...src('3840x2160', 24), '-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', '25M', '-pix_fmt', 'yuv420p10le', '-g', '48', ...audio]
    ]
  }
];

for (const job of jobs) {
  const dest = path.join(OUT, job.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
    console.log(`${job.name}: already present`);
    continue;
  }
  let ok = false;
  for (const [i, args] of job.variants.entries()) {
    console.log(`encoding ${job.name} (variant ${i + 1}/${job.variants.length})`);
    const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args, dest], {stdio: 'inherit'});
    if (r.status === 0) {
      ok = true;
      break;
    }
    console.log(`variant ${i + 1} failed (exit ${r.status})`);
  }
  if (!ok) {
    console.error(`${job.name}: all variants failed`);
    process.exit(1);
  }
  console.log(`${job.name}: ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
}
