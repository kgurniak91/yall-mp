// Reference: CPU/GPU of the REAL current app (stacked windows + mpv.exe --wid + live Angular UI), measured with the same sampler.
//   node bench/real-app.js [--file=media/1080p60-h264.mp4] [--runs=3] [--warmup=10] [--measure=60] [--tag=name]
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {_electron} = require(path.join(__dirname, '..', '..', '..', 'node_modules', '@playwright', 'test'));

const REPO = path.join(__dirname, '..', '..', '..');
const RAW = path.join(__dirname, '..', 'results', 'raw');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v === undefined ? true : v];
}));
const file = path.resolve(__dirname, '..', args.file || 'media/1080p60-h264.mp4');
const hwdec = args.hwdec || 'auto';
const tag = args.tag || `${path.basename(file).split('-')[0]}-${hwdec}`;
const RUNS = parseInt(args.runs || '3', 10);
const WARMUP = parseFloat(args.warmup || '10');
const MEASURE = parseFloat(args.measure || '60');
const ID = '00000000-0000-4000-8000-00000000e2e0';
const srt = path.join(REPO, 'test', 'e2e', 'fixtures', 'sample.srt');

function seed(dir) {
  const now = Date.now();
  const minimal = {id: ID, catalogId: '', mediaFileName: path.basename(file), subtitleFileName: 'sample.srt', mediaPath: file,
    createdDate: now, lastOpenedDate: now, duration: 90, lastPlaybackTime: 0, subtitleCount: 3, lastSubtitleEndTime: 8.5};
  const project = {...minimal, subtitleSelection: {type: 'external', filePath: srt}, detectedLanguage: 'other', subtitles: [], audioTracks: [],
    subtitleTracks: [], ankiTags: [], settings: {autoPauseAtStart: false, autoPauseAtEnd: false, subtitledClipSpeed: 1, gapSpeed: 1, skipGaps: false,
      speedOverride: 0.5, subtitleBehavior: 'DoNothing', selectedAudioTrackIndex: null, useMpvSubtitles: false, assScale: 1, assScalePercentage: 100,
      subtitlesVisible: true, subtitlesLanguage: 'other', defaultSubtitleLookupServiceId: null}};
  fs.mkdirSync(path.join(dir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'yall-mp-app-data.json'), JSON.stringify({projects: [minimal], lastOpenedProjectId: ID, globalSettings: {hardwareAcceleration: hwdec === 'auto'}}));
  fs.writeFileSync(path.join(dir, 'projects', `${ID}.json`), JSON.stringify(project));
}

const sampler = (pid, out) => new Promise(resolve => {
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'sampler.ps1'), '-RootPid', String(pid),
    '-WarmupSec', String(WARMUP + 1), '-DurationSec', String(Math.max(5, MEASURE - 2)), '-Out', out], {stdio: 'ignore'}).on('exit', resolve);
});

(async () => {
  for (let run = 1; run <= RUNS; run++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-real-'));
    seed(dir);
    const app = await _electron.launch({args: ['.'], cwd: REPO, env: {...process.env, YALL_MP_E2E: '1', YALL_MP_USER_DATA_DIR: dir}});
    let ui;
    for (let i = 0; i < 150 && !ui; i++) {
      for (const p of app.windows()) {
        if (!p.url().includes('/dist/yall-mp/browser/') || p.url().includes('draggable-host')) continue;
        if (await p.evaluate(() => typeof window.electronAPI?.windowMinimize === 'function').catch(() => false)) ui = p;
      }
      if (!ui) await new Promise(r => setTimeout(r, 200));
    }
    if (!ui) throw new Error('no UI window');
    await ui.locator('#mpv-placeholder .resizing-overlay').waitFor({state: 'detached', timeout: 30000});
    await ui.locator('.interaction-blocker').waitFor({state: 'detached', timeout: 30000}).catch(() => {});
    const bounds = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w => ({url: w.webContents.getURL().split('/').pop(), b: w.getBounds(), vis: w.isVisible()})));
    await ui.evaluate(() => { window.__pb = null; window.electronAPI.onPlaybackStateUpdate(s => { window.__pb = s; }); });
    await ui.bringToFront().catch(() => {});
    await ui.keyboard.press('Space');
    await new Promise(r => setTimeout(r, 2500));
    const st = await ui.evaluate(() => window.__pb);
    console.log('  state after Space:', JSON.stringify(st));
    if (!st || !/Playing|Transitioning|AutoPaused/.test(st.playerState)) throw new Error('playback did not start');
    const out = path.join(RAW, `real-app-${tag}-run${run}.json`);
    console.log(`run ${run}/${RUNS} pid ${app.process().pid} windows ${JSON.stringify(bounds)}`);
    await sampler(app.process().pid, out + '.tmp');
    const cpu = JSON.parse(fs.readFileSync(out + '.tmp', 'utf8').replace(/^﻿/, ''));
    fs.rmSync(out + '.tmp');
    fs.writeFileSync(out, JSON.stringify({file: path.basename(file), windows: bounds, cpu}, null, 2));
    console.log(`  app CPU % of one core ${cpu.appCpuPctOfOneCore} by process ${JSON.stringify(cpu.cpuPctOfOneCoreByProcess)} gpu3d ${cpu.gpu.app3d} vdec ${cpu.gpu.appVideoDecode}`);
    await app.close().catch(() => {});
    await new Promise(r => setTimeout(r, 4000));
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
