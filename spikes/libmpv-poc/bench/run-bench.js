// Benchmark matrix runner: for each cell it launches the spike (main.js --bench-out) next to bench/sampler.ps1,
// stores one JSON per run in results/raw/ (resumable), and writes the median table to results/bench-table.md.
//   node bench/run-bench.js [--runs=3] [--warmup=10] [--measure=60] [--only=text] [--quick] [--force] [--report]
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'results', 'raw');
const electronExe = require(path.join(ROOT, '..', '..', 'node_modules', 'electron'));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));
const quick = !!args.quick;
const RUNS = parseInt(args.runs || (quick ? '1' : '3'), 10);
const WARMUP = parseFloat(args.warmup || (quick ? '3' : '10'));
const MEASURE = parseFloat(args.measure || (quick ? '8' : '60'));
const ONLY = args.only ? String(args.only).split(',') : null;
const DRAW = args.draw || '2d'; // draw path of the main shared matrix; overwritten by the Q2 sub-matrix result if known

const MEDIA = ['real-railgun.mkv', '1080p30-h264.mp4', '1080p60-h264.mp4', '2160p24-hevc10.mkv'];
const HWDEC = ['auto', 'no'];
const MODES = ['legacy', 'shared', 'readback-ipc', 'readback-shm'];

const cells = [];
for (const file of MEDIA) {
  for (const hwdec of HWDEC) {
    for (const mode of MODES) cells.push({file, hwdec, mode, draw: DRAW});
  }
}
// Q2 sub-matrix: draw paths at 1080p60, hwdec auto (the 2d one is already in the main matrix when DRAW=2d).
for (const draw of ['webgpu', 'webgl', '2d']) {
  if (draw !== DRAW) cells.push({file: '1080p60-h264.mp4', hwdec: 'auto', mode: 'shared', draw});
}

const cellId = c => `${c.file.split('-')[0]}-${c.hwdec}-${c.mode}${c.mode === 'shared' ? '-' + c.draw : ''}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function runSampler(rootPid, warmup, duration, out) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'sampler.ps1'),
      '-RootPid', String(rootPid), '-WarmupSec', String(warmup), '-DurationSec', String(duration), '-Out', out], {stdio: 'ignore'});
    p.on('exit', resolve);
  });
}

async function runCell(c, run) {
  const id = cellId(c);
  const base = path.join(RAW, `${id}-run${run}`);
  if (!args.force && fs.existsSync(`${base}.json`)) {
    console.log(`skip ${id} run ${run} (exists)`);
    return;
  }
  const appOut = `${base}.app.json`;
  const cpuOut = `${base}.cpu.json`;
  for (const f of [appOut, cpuOut]) fs.rmSync(f, {force: true});
  const eargs = [ROOT, `--mode=${c.mode}`, `--draw=${c.draw}`, `--hwdec=${c.hwdec}`, `--file=${path.join(ROOT, 'media', c.file)}`,
    `--bench-out=${appOut}`, `--warmup=${WARMUP}`, `--measure=${MEASURE}`, '--quiet', ...(c.file.startsWith('real-') ? ['--subs'] : []), `--out=${path.join(ROOT, 'results', 'raw', 'probes')}`];
  console.log(`run  ${id} run ${run}/${RUNS}`);
  const proc = spawn(electronExe, eargs, {stdio: 'ignore'});
  const exited = new Promise(r => proc.on('exit', r));
  const killer = setTimeout(() => proc.kill(), (WARMUP + MEASURE + 40) * 1000);
  const sampler = runSampler(proc.pid, WARMUP + 1, Math.max(5, MEASURE - 2), cpuOut);
  await Promise.all([exited, sampler]);
  clearTimeout(killer);
  if (!fs.existsSync(appOut) || !fs.existsSync(cpuOut)) {
    console.log(`  FAILED ${id} run ${run}: missing output (${fs.existsSync(appOut) ? '' : 'app '}${fs.existsSync(cpuOut) ? '' : 'cpu'})`);
    return;
  }
  const merged = {cell: c, run, app: JSON.parse(fs.readFileSync(appOut, 'utf8').replace(/^﻿/, '')), cpu: JSON.parse(fs.readFileSync(cpuOut, 'utf8').replace(/^﻿/, ''))};
  fs.writeFileSync(`${base}.json`, JSON.stringify(merged, null, 2));
  fs.rmSync(appOut);
  fs.rmSync(cpuOut);
  await sleep(3000); // let GPU and disk settle
}

const median = xs => {
  const v = xs.filter(x => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const f = (x, d = 1) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));

function report() {
  const rows = [];
  for (const c of cells) {
    const id = cellId(c);
    const runs = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter(n => n.startsWith(id + '-run') && n.endsWith('.json') && !n.includes('.app.') && !n.includes('.cpu.')) : [];
    if (!runs.length) continue;
    const data = runs.map(n => JSON.parse(fs.readFileSync(path.join(RAW, n), 'utf8')));
    const m = fn => median(data.map(fn));
    rows.push({
      id, n: data.length, c,
      cpuTotal: m(d => d.cpu.appCpuPctOfTotal), cpuCore: m(d => d.cpu.appCpuPctOfOneCore), dwm: m(d => d.cpu.dwmCpuPctOfOneCore),
      gpu3d: m(d => d.cpu.gpu.app3d), vdec: m(d => d.cpu.gpu.appVideoDecode), vproc: m(d => d.cpu.gpu.appVideoProcessing), copy: m(d => d.cpu.gpu.appCopy),
      drops: m(d => (d.app.frameDrop || 0) + (d.app.decoderDrop || 0)), delayed: m(d => d.app.voDelayed),
      expected: m(d => d.app.expectedFrames), avsync: m(d => d.app.avsyncMaxAbs), fps: m(d => d.app.drawnFps), fpsMin: m(d => d.app.drawnFpsMin),
      rdrop: m(d => d.app.rendererDropped), ltMs: m(d => d.app.longTaskMs), gap: m(d => d.app.maxGapMs), fail: m(d => d.app.sendFailures),
      exhausted: m(d => d.app.poolExhausted), hwdec: data[0].app.hwdecCurrent
    });
  }
  const head = '| cell | runs | hwdec used | app CPU % total | app CPU % of 1 core | dwm CPU % core | GPU 3D % | VideoDecode % | VideoProc % | mpv drops | vo-delayed | drop % | avsync max (ms) | drawn fps (min) | renderer dropped | long-task ms | max gap ms | send fail | pool exhausted |\n|' + '---|'.repeat(19);
  const lines = rows.map(r => {
    const dropPct = r.expected ? (100 * r.drops / r.expected) : null;
    return `| ${r.id} | ${r.n} | ${r.hwdec ?? '-'} | ${f(r.cpuTotal)} | ${f(r.cpuCore)} | ${f(r.dwm)} | ${f(r.gpu3d)} | ${f(r.vdec)} | ${f(r.vproc)} | ${f(r.drops, 0)} | ${f(r.delayed, 0)} | ${f(dropPct, 2)} | ${f(r.avsync === null ? null : r.avsync * 1000, 1)} | ${f(r.fps)} (${f(r.fpsMin, 0)}) | ${f(r.rdrop, 0)} | ${f(r.ltMs, 0)} | ${f(r.gap, 0)} | ${f(r.fail, 0)} | ${f(r.exhausted, 0)} |`;
  });
  const out = path.join(ROOT, 'results', 'bench-table.md');
  fs.writeFileSync(out, [head, ...lines].join('\n') + '\n');
  console.log(`wrote ${out} (${rows.length} cells)`);
}

(async () => {
  if (args.report) return report();
  fs.mkdirSync(path.join(RAW, 'probes'), {recursive: true});
  // Idle baseline (dwm and whole-GPU only).
  const idleOut = path.join(RAW, 'idle.json');
  if (args.force || !fs.existsSync(idleOut)) {
    console.log('idle baseline');
    await runSampler(0, 1, Math.max(5, quick ? 5 : 20), idleOut);
  }
  const todo = cells.filter(c => !ONLY || ONLY.some(o => cellId(c).includes(o)));
  console.log(`${todo.length} cells x ${RUNS} runs, warmup ${WARMUP}s, measure ${MEASURE}s`);
  for (const c of todo) {
    for (let run = 1; run <= RUNS; run++) await runCell(c, run);
    report();
  }
  report();
})();
