// Generates the self-made E2E fixtures into test/e2e/fixtures/ using ffmpeg-static.
// The outputs are committed (see test/e2e/fixtures/README.md), so this only needs re-running when the fixtures change.
const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const OUT = path.join(__dirname, '..', 'test', 'e2e', 'fixtures');
const MAX_TOTAL_BYTES = 1024 * 1024;

const LINES = [
  {start: 0.5, end: 2.5, text: 'Red line one'},
  {start: 3.5, end: 5.5, text: 'Green line two'},
  {start: 6.5, end: 8.5, text: 'Blue line three'},
];

function ts(seconds, sep) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s}${sep}${f}`;
}

function writeSrt() {
  const body = LINES.map((l, i) => `${i + 1}\n${ts(l.start, ',')} --> ${ts(l.end, ',')}\n${l.text}\n`).join('\n');
  fs.writeFileSync(path.join(OUT, 'sample.srt'), body);
}

function writeAss() {
  const assTs = (sec) => {
    const cs = Math.round(sec * 100);
    const h = Math.floor(cs / 360000);
    const m = String(Math.floor(cs / 6000) % 60).padStart(2, '0');
    const s = String(Math.floor(cs / 100) % 60).padStart(2, '0');
    return `${h}:${m}:${s}.${String(cs % 100).padStart(2, '0')}`;
  };
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 640',
    'PlayResY: 360',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = LINES.map(l => `Dialogue: 0,${assTs(l.start)},${assTs(l.end)},Default,,0,0,0,,${l.text}`);
  fs.writeFileSync(path.join(OUT, 'sample-styled.ass'), [...header, ...events, ''].join('\n'));
}

function ffmpeg(args) {
  const res = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {encoding: 'utf8'});
  if (res.status !== 0) {
    console.error(res.stderr);
    throw new Error(`ffmpeg failed: ${args.join(' ')}`);
  }
}

// Red / green / blue segments with a moving testsrc2 inset in the top-left, so the centre stays a solid colour
function videoInputs(segments) {
  const args = [];
  for (const [color, dur] of segments) {
    args.push('-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=${dur}`);
  }
  const total = segments.reduce((sum, s) => sum + s[1], 0);
  args.push('-f', 'lavfi', '-i', `testsrc2=s=128x72:r=30:d=${total}`);
  args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${total}`);
  const n = segments.length;
  const filter = `${segments.map((_, i) => `[${i}:v]`).join('')}concat=n=${n}:v=1:a=0[bg];[bg][${n}:v]overlay=16:16[v]`;
  return {args, filter, audioIndex: n + 1, total};
}

function makeMp4() {
  const {args, filter, audioIndex, total} = videoInputs([['red', 3], ['green', 3], ['blue', 4]]);
  ffmpeg([
    ...args, '-filter_complex', filter, '-map', '[v]', '-map', `${audioIndex}:a`, '-t', String(total),
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '64k',
    path.join(OUT, 'sample.mp4'),
  ]);
}

function makeMkv() {
  const {args, filter, audioIndex, total} = videoInputs([['red', 2], ['green', 2], ['blue', 1]]);
  const assIndex = audioIndex + 1;
  ffmpeg([
    ...args, '-i', path.join(OUT, 'sample-styled.ass'),
    '-filter_complex', `${filter};[${audioIndex}:a]pan=5.1(side)|FL=c0|FR=c0|FC=c0|LFE=c0|SL=c0|SR=c0[a]`,
    '-map', '[v]', '-map', '[a]', '-map', `${assIndex}:s`, '-t', String(total),
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'ac3', '-b:a', '192k', '-c:s', 'copy',
    path.join(OUT, 'sample-5.1.mkv'),
  ]);
}

fs.mkdirSync(OUT, {recursive: true});
writeSrt();
writeAss();
makeMp4();
makeMkv();

let total = 0;
for (const name of ['sample.mp4', 'sample.srt', 'sample-styled.ass', 'sample-5.1.mkv']) {
  const size = fs.statSync(path.join(OUT, name)).size;
  total += size;
  console.log(`${name}: ${size} bytes`);
}
console.log(`total: ${total} bytes`);
if (total >= MAX_TOTAL_BYTES) {
  console.error('Fixtures exceed the 1 MB budget');
  process.exit(1);
}
