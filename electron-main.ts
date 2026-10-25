import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  session,
  shell,
  WebContentsView
} from 'electron';
import path from 'path';
import os from 'os';
import {appendFileSync, existsSync, promises as fs, statSync, writeFileSync} from 'fs';
import type {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {SrtSubtitleData, SubtitleData} from './shared/types/subtitle.type';
import type {MediaTrack} from './shared/types/media.type';
import {AnkiBatchExportRequest, AnkiCard, AnkiFieldMappingSource} from './src/app/model/anki.types';
import {v4 as uuidv4} from 'uuid';
import {ChildProcess, execFile, spawn} from 'child_process';
import {ensureLibmpv, LibmpvManager} from './libmpv-manager';
import {backendAfterGpuLoss, GpuInfoLike, LibmpvFrameSender, PreferredBackend, PROBE_REPORT_CHANNEL} from './libmpv-frame-sender';
import type {AdapterOption} from './libmpv-bridge';
import {FontData, ParsedSubtitlesData} from './src/electron-api';
import {AppData, CoreConfig, Project, SubtitleSelection, SupportedLanguage} from './src/app/model/project.types';
import {
  assignTracksToSubtitles,
  dialoguesToAssSubtitleData,
  mergeIdenticalConsecutiveSubtitles,
  mergeKaraokeSubtitles
} from './shared/utils/subtitle-parsing';
import {PlaybackManager} from './playback-manager';
import {EngineRestartPolicy} from './engine-restart';
import {BenchConfig, loadBenchConfig} from './bench-config';
import type fontkit from 'fontkit';
import {
  SUPPORTED_MEDIA_TYPES,
  SUPPORTED_SUBTITLE_TYPES,
  SUPPORTED_TEXT_SUBTITLE_CODECS
} from './src/app/model/video.types';
import {YomitanManager} from './yomitan-manager';
import {LEGACY_TO_YOMITAN_ISO_MAP} from './shared/types/yomitan';

let customExecutables: { libmpv?: string, ffmpeg?: string, ffprobe?: string, audiowaveform?: string } = {};
let isFfmpegPathsInitialized = false;

const isE2E = process.env.YALL_MP_E2E === '1';

// E2E tests give every run its own userData dir (and therefore its own single-instance lock)
if (process.env.YALL_MP_USER_DATA_DIR) {
  app.setPath('userData', process.env.YALL_MP_USER_DATA_DIR);
  console.log(`[Main] Data path overridden by YALL_MP_USER_DATA_DIR: ${process.env.YALL_MP_USER_DATA_DIR}`);
} else if (!app.isPackaged) {
  // Data isolation for development purposes only to avoid corrupting real study data on the local machine
  const userDataPath = path.join(app.getPath('appData'), 'yall-mp-dev');
  app.setPath('userData', userDataPath);
  console.log(`[Main] Development mode detected. Data path set to: ${userDataPath}`);
}

// A native crash (libmpv runs in this process) leaves a minidump in the crash dumps folder; nothing is uploaded.
crashReporter.start({uploadToServer: false});

interface AvailableFont {
  family: string;
  style: string;
  isBold: boolean;
  isItalic: boolean;
  dataUri: string;
  source: 'mkv' | 'local' | 'system'; // Track where the font was found
}

interface RequiredFont {
  family: string;
  bold: boolean;
  italic: boolean;
}

const APP_DATA_KEY = 'yall-mp-app-data';
const APP_DATA_PATH = path.join(app.getPath('userData'), `${APP_DATA_KEY}.json`);
const DIALOG_STATE_PATH = path.join(app.getPath('userData'), 'dialog-state.json');
const PROJECTS_DIR = path.join(app.getPath('userData'), 'projects');
const FONT_CACHE_DIR = path.join(app.getPath('userData'), 'font-cache');
const USER_AGENT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};
const LOOKUP_PARTITION = 'persist:yall_mp_lookup_session';

let playbackManager: PlaybackManager | null = null;
let mpvManager: LibmpvManager | null = null;
let yomitanManager: YomitanManager | null = null;
let mainWindow: BrowserWindow | null = null;
let subtitlesLookupWindow: BrowserWindow | null = null;
let subtitlesLookupView: WebContentsView | null = null;
let currentSubtitlesLookupContext: { clipSubtitleId: string; originalSelection: string; } | null = null;
let isFFmpegAvailable = false;
let ffmpegPath = '';
let ffprobePath = '';
let hasRequestedInitialSeek = false;
// Frames sent when the first seek was requested: the picture at the resume position is the first one after it.
let initialSeekFrameBaseline = 0;
let videoSender: LibmpvFrameSender | null = null;
let viewportArgs: ViewportArgs | null = null;
const engineRestartPolicy = new EngineRestartPolicy();
// Last canvas backing size (CSS px x scale factor) reported by the page.
let videoCanvasSize: { width: number; height: number } | null = null;
// Chromium GPU-process losses: the first one costs the open project the shared backend, the next project tries it
// again (if GPU compositing is still enabled), a second loss means readback until the app restarts.
let gpuLossCount = 0;
let gpuLossSinceOpen = 0;
let gpuInfoPromise: Promise<GpuInfoLike | null> | null = null;
let isSaving = false;
let displaySleepBlockerId: number | null = null;
let coreConfigToSave: CoreConfig | null = null;
const projectsToSave = new Map<string, Project>();

let pendingFilesToOpen: string[] = [];

async function ensureFFmpegPaths(): Promise<void> {
  if (isFfmpegPathsInitialized) {
    return;
  }

  isFfmpegPathsInitialized = true;

  console.log('Initializing FFmpeg/FFprobe paths for the first time...');

  const fsLib = require('fs');
  ffmpegPath = customExecutables.ffmpeg && fsLib.existsSync(customExecutables.ffmpeg) ? customExecutables.ffmpeg : '';
  ffprobePath = customExecutables.ffprobe && fsLib.existsSync(customExecutables.ffprobe) ? customExecutables.ffprobe : '';

  if (!ffmpegPath) {
    const ffmpegStatic = (await import('ffmpeg-static')).default;
    if (ffmpegStatic) {
      ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
    }
  }

  if (!ffprobePath) {
    const ffprobeStatic = (await import('ffprobe-static')).default;
    if (ffprobeStatic && ffprobeStatic.path) {
      ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
    }
  }

  if (ffmpegPath && ffprobePath) {
    isFFmpegAvailable = true;
  } else {
    console.warn('FFmpeg or FFprobe binaries not found. Media features will be disabled.');
  }
}

let benchConfig: BenchConfig | null = null;
let benchStarted = false;
if (process.env.YALL_MP_BENCH) {
  try {
    benchConfig = loadBenchConfig(process.env.YALL_MP_BENCH);
  } catch (error) {
    console.error('[Bench] Could not read YALL_MP_BENCH:', error);
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Benchmark mode: once the first frame at the resume position is out, size the window, play, and after the warm-up
 * collect the counters of one measuring window into a json file, then quit. Needs no test runner, so it also runs in a packaged build.
 */
async function runBench(config: BenchConfig): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  const readPage = <T>(expression: string): Promise<T | null> =>
    window.webContents.executeJavaScript(expression).catch(() => null);
  const pageStats = () => readPage<Record<string, number>>('window.__yallVideoStats ? {...window.__yallVideoStats} : null');
  const mpvProperty = (name: string) => (mpvManager?.getProperty(name) ?? Promise.resolve(null)).catch(() => null);
  try {
    logVideo(`[Bench] Starting: ${JSON.stringify(config)}`);
    if (window.isMaximized() || window.isFullScreen()) {
      window.setFullScreen(false);
      window.unmaximize();
    }
    const bounds = window.getBounds();
    window.setBounds({x: bounds.x, y: bounds.y, width: config.width, height: config.height});
    await delay(800);
    playbackManager?.play();
    await delay(config.warmupSec * 1000);
    const before = await pageStats();
    const timePosBefore = await mpvProperty('time-pos');
    app.getAppMetrics(); // percentCPUUsage is relative to the previous call, so this starts the measuring window
    const startedAt = Date.now();
    // Tells an external sampler that the measuring window has begun
    writeFileSync(`${config.out}.measuring`, '');
    await delay(config.measureSec * 1000);
    const after = await pageStats();
    const timePosAfter = await mpvProperty('time-pos');
    // % of one core per process, summed by process type (Browser = main process with libmpv, GPU, Tab = renderer)
    const cpuByProcessType: Record<string, number> = {};
    for (const metric of app.getAppMetrics()) {
      cpuByProcessType[metric.type] = (cpuByProcessType[metric.type] ?? 0) + metric.cpu.percentCPUUsage;
    }
    const seconds = (Date.now() - startedAt) / 1000;
    const sender = videoSender?.stats();
    const gpu = await app.getGPUInfo('basic').catch(() => null) as { gpuDevice?: Array<Record<string, unknown>> } | null;
    const result = {
      config, seconds, platform: process.platform, version: app.getVersion(),
      // Media seconds played per wall-clock second: below 1 means the machine cannot keep real time
      playbackSpeedRatio: typeof timePosBefore === 'number' && typeof timePosAfter === 'number' ? (timePosAfter - timePosBefore) / seconds : null,
      mpvSpeed: await mpvProperty('speed'),
      cpuByProcessType,
      presentedFps: before && after ? (after.drawn - before.drawn) / seconds : null,
      page: after,
      sender,
      mpv: {
        frameDrops: await mpvProperty('frame-drop-count'),
        delayedFrames: await mpvProperty('vo-delayed-frame-count'),
        decoderDrops: await mpvProperty('decoder-frame-drop-count'),
        avsync: await mpvProperty('avsync'),
        hwdecCurrent: await mpvProperty('hwdec-current'),
        decodedFormat: await mpvProperty('video-params/pixelformat'),
        outputFormat: await mpvProperty('video-out-params/pixelformat'),
        videoSync: await mpvProperty('video-sync'),
        decoderThreads: await mpvProperty('vd-lavc-threads'),
        currentVo: await mpvProperty('current-vo'),
        estimatedFps: await mpvProperty('estimated-vf-fps')
      },
      activeGpu: gpu?.gpuDevice?.find(device => device.active) ?? null,
      gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
      videoLogHasFallback: Boolean(sender?.fallbackReason)
    };
    writeFileSync(config.out, JSON.stringify(result, null, 2));
    logVideo(`[Bench] Done, result in ${config.out}`);
  } catch (error) {
    logVideo(`[Bench] Failed: ${error instanceof Error ? error.message : error}`);
    try {
      writeFileSync(config.out, JSON.stringify({error: String(error)}));
    } catch {
      // nothing more to report
    }
  } finally {
    app.quit();
  }
}

function finishInitialSeek() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (benchConfig && !benchStarted) {
    benchStarted = true;
    void runBench(benchConfig);
  }
  console.log('[Main Process] First frame at the resume position is out. Notifying UI.');
  mainWindow.webContents.send('mpv:initial-seek-complete');
  hasRequestedInitialSeek = false;
}

interface ViewportArgs {
  mediaPath: string;
  audioTrackIndex: number | null;
  subtitleSelection: SubtitleSelection;
  subtitleTracks: MediaTrack[];
  useMpvSubtitles: boolean;
  subtitlesVisible: boolean;
  hardwareAcceleration: boolean;
  volume: number;
  isMuted: boolean;
}

type EngineErrorState = 'restarting' | 'failed';

function sendEngineError(state: EngineErrorState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mpv:engine-error', state);
  }
}

/**
 * Creates the playback engine for the open project. With `resumeAt` it replaces an engine that stopped unexpectedly:
 * the playback state machine is kept and the file is loaded again, paused, at that position.
 */
async function launchEngine(args: ViewportArgs, resumeAt?: number): Promise<void> {
  const window = mainWindow;
  if (!window) {
    return;
  }
  const gpuInfo = await gpuInfoPromise;
  const pageContents = window.webContents;
  const initialSize = initialVideoCanvasSize(window);

  const manager = new LibmpvManager({
    basePath: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    customLibmpvPath: customExecutables.libmpv,
    attachVideo: async libmpv => {
      const sender = new LibmpvFrameSender({
        libmpv, webContents: pageContents, gpuInfo: gpuInfo ?? undefined, adapter: videoAdapterOverride(),
        log: logVideo, preferredAfterDeviceLoss: preferredVideoBackend, simulateBlackFrames: isE2E && process.env.YALL_MP_E2E_SIMULATE_BLACK_FRAMES === '1'
      });
      videoSender = sender;
      let attach;
      try {
        attach = await sender.start({...initialSize, preferred: preferredVideoBackend()});
      } catch (error) {
        sender.stop();
        if (videoSender === sender) {
          videoSender = null;
        }
        throw error;
      }
      logVideo(`[Main Process] Video backend policy at project open: preferred=${preferredVideoBackend()} ` +
        `gpuLosses=${gpuLossCount} gpu_compositing=${app.getGPUFeatureStatus().gpu_compositing}`);
      const a = attach.adapter;
      const info = libmpv.info;
      logVideo(`[Main Process] Video: backend=${attach.backend} impl=${attach.impl} gpuWait=${attach.gpuWaitImpl} ` +
        `adapter=${a.name} (${a.vendorId}/${a.deviceId}${a.software ? ', software' : ''}) canvas=${initialSize.width}x${initialSize.height} ` +
        `platform=${info.platform} libmpv=${info.kind} api=${info.apiVersion.join('.')} lib=${info.libraryPath ?? 'unknown'}`);
      return () => {
        sender.stop();
        if (videoSender === sender) {
          videoSender = null;
        }
      };
    }
  });
  mpvManager = manager;

  if (resumeAt === undefined || !playbackManager) {
    playbackManager = new PlaybackManager(manager, window);
    playbackManager.setInitialVolumeState(args.volume, args.isMuted);
    playbackManager.on('repeat-seek-completed', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('playback:repeat-seek-completed');
      }
    });
  } else {
    playbackManager.rebind(manager);
  }

  manager.on('status', (status) => {
    if (mainWindow) {
      mainWindow.webContents.send('mpv:event', status)
    }
  });

  manager.on('status', (status) => {
    if (status.event === 'property-change' && status.name === 'pause') {
      setDisplaySleepBlocked(status.data === false);
    } else if (status.event === 'end-file') {
      setDisplaySleepBlocked(false);
    }
  });

  const onMpvStatus = (status: any) => {
    // Listen for confirmation only if seek requested
    // This ignores the premature playback-restart at t=0.
    if (status.event === 'playback-restart' && hasRequestedInitialSeek) {
      console.log('[Main Process] Confirmed playback-restart AFTER seek request.');

      // This is only needed once:
      manager.removeListener('status', onMpvStatus);

      // Wait for the picture of that seek; a file without video never produces one, so the wait is bounded.
      const sender = videoSender;
      const arrived = sender ? sender.waitForFrame(initialSeekFrameBaseline, 1000) : Promise.resolve(false);
      void arrived.then(() => {
        if (manager === mpvManager) {
          finishInitialSeek();
        }
      });
    }
  };
  manager.on('status', onMpvStatus);

  manager.on('error', (err) => {
    console.error("MPV Error:", err);
    setDisplaySleepBlocked(false);
    void restartEngineAfterError(manager);
  });
  manager.on('ready', () => {
    console.log('[Main Process] LibmpvManager is ready. Notifying renderer.');
    if (mainWindow) {
      mainWindow.webContents.send('mpv:managerReady');
    }
  });

  try {
    await manager.start(args.mediaPath, args.audioTrackIndex, args.subtitleSelection, args.subtitleTracks, args.useMpvSubtitles, args.subtitlesVisible, args.hardwareAcceleration, args.volume, args.isMuted);
  } catch (error) {
    console.error('[Main Process] Critical error during MPV startup:', error);
    // Re-throw the error so the renderer process's Promise is rejected.
    throw error;
  }

  if (resumeAt !== undefined && manager === mpvManager) {
    await manager.sendCommand(['seek', resumeAt, 'absolute', 'exact']);
    playbackManager?.pause();
  }
}

/** The engine stopped by itself (libmpv shut down, or the Linux host process died): start a new one at the same position, once a minute at most. */
async function restartEngineAfterError(failed: LibmpvManager): Promise<void> {
  if (failed !== mpvManager || !viewportArgs) {
    return;
  }
  const args = viewportArgs;
  const position = playbackManager?.position ?? 0;
  await failed.stop();
  if (!engineRestartPolicy.tryRestart()) {
    logVideo('[Main Process] Playback engine stopped again within a minute; not restarting.');
    sendEngineError('failed');
    return;
  }
  logVideo(`[Main Process] Playback engine stopped unexpectedly; restarting at ${position.toFixed(2)} s.`);
  sendEngineError('restarting');
  try {
    await launchEngine(args, position);
  } catch (error) {
    logVideo(`[Main Process] Playback engine could not restart: ${error instanceof Error ? error.message : error}`);
    sendEngineError('failed');
  }
}

const VIDEO_BACKENDS: PreferredBackend[] = ['auto', 'readback', 'd3d11-shared', 'iosurface-shared', 'dmabuf-shared'];
const VIDEO_LOG_PATH = path.join(app.getPath('userData'), 'video.log');
const VIDEO_LOG_MAX_BYTES = 256 * 1024;
let isVideoLogReset = false;

/** Console plus `video.log` in the userData folder: which backend and adapter a machine ended up on, and why. */
function logVideo(message: string): void {
  console.log(message);
  try {
    if (!isVideoLogReset) {
      isVideoLogReset = true;
      if (existsSync(VIDEO_LOG_PATH) && statSync(VIDEO_LOG_PATH).size > VIDEO_LOG_MAX_BYTES) {
        writeFileSync(VIDEO_LOG_PATH, '');
      }
    }
    appendFileSync(VIDEO_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // diagnostics only
  }
}

/** `YALL_MP_VIDEO_BACKEND` (auto, readback, d3d11-shared, iosurface-shared, dmabuf-shared) for diagnostics and CI. */
function preferredVideoBackend(): PreferredBackend {
  return backendAfterGpuLoss({
    configured: configuredVideoBackend(),
    lossCount: gpuLossCount,
    lossSinceOpen: gpuLossSinceOpen,
    compositingEnabled: String(app.getGPUFeatureStatus().gpu_compositing).startsWith('enabled')
  });
}

function configuredVideoBackend(): PreferredBackend {
  const value = process.env.YALL_MP_VIDEO_BACKEND as PreferredBackend | undefined;
  if (value && VIDEO_BACKENDS.includes(value)) {
    return value;
  }
  // The macOS GPU backend is verified on a software GL renderer only (CI has no Mac with a GPU): readback stays the
  // default there until it was seen working on real hardware; `YALL_MP_VIDEO_BACKEND=iosurface-shared` opts in; Linux `dmabuf-shared` is opt-in the same way (auto resolves to readback there).
  return process.platform === 'darwin' ? 'readback' : 'auto';
}

/** `YALL_MP_VIDEO_ADAPTER=warp` forces the software adapter (what the GPU-less CI runner has). */
function videoAdapterOverride(): AdapterOption | undefined {
  const value = process.env.YALL_MP_VIDEO_ADAPTER;
  return value === 'warp' || value === 'default' ? value : undefined;
}

function initialVideoCanvasSize(window: BrowserWindow): { width: number; height: number } {
  if (videoCanvasSize) {
    return videoCanvasSize;
  }
  const [width, height] = window.getContentSize();
  const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor || 1;
  return {width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale))};
}

/** mpv's own window used to keep the display awake while playing; with libmpv the app has to ask for it. */
function setDisplaySleepBlocked(blocked: boolean): void {
  if (blocked === (displaySleepBlockerId !== null)) {
    return;
  }
  if (blocked) {
    displaySleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('[Main Process] Display sleep blocked while playing.');
  } else {
    powerSaveBlocker.stop(displaySleepBlockerId!);
    displaySleepBlockerId = null;
    console.log('[Main Process] Display sleep allowed again.');
  }
}

function handleWindowEscape() {
  if (!mainWindow || mainWindow.isMinimized()) {
    return;
  }

  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  } else if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.minimize();
  }
}

function blockDefaultBrowserShortcuts(event: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown') {
    return;
  }

  const key = input.key.toLowerCase();
  const isModifier = input.control || input.meta; // Ctrl on Win/Linux, Cmd on Mac

  // Intercept Alt+F4 to ensure it closes the main window, not just the focused child window
  if (input.alt && key === 'f4') {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return;
  }

  // Block app reloading
  if ((isModifier && key === 'r') || key === 'f5') {
    event.preventDefault();
  }

  // Block opening new windows (Ctrl+N)
  if (isModifier && key === 'n') {
    event.preventDefault();
  }

  // Block window/tab closing (Ctrl+W)
  if (isModifier && key === 'w') {
    event.preventDefault();
  }

  // Block zooming (Ctrl++, Ctrl+-, Ctrl+0)
  if (isModifier && (key === '=' || key === '-' || key === '0')) {
    event.preventDefault();
  }

  // Block opening DevTools (F12, Ctrl+Shift+I)
  if (key === 'f12' || (isModifier && input.shift && key === 'i')) {
    event.preventDefault();
  }

  // Block "Save as" (Ctrl+S)
  if (isModifier && key === 's') {
    event.preventDefault();
  }
}

function getWindowIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  // On X11 Chromium drops window icons above 128 px, so the 1024 px source would leave the default icon
  return process.platform === 'linux' && !icon.isEmpty() ? icon.resize({width: 128, height: 128}) : icon;
}

async function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;

  // The minimum size must not exceed a small work area, or the window would start taller than the screen
  const minWidth = Math.min(800, workArea.width);
  const minHeight = Math.min(600, workArea.height);

  // 90% of the work area, centered
  const initialWidth = Math.max(minWidth, Math.round(workArea.width * 0.9));
  const initialHeight = Math.max(minHeight, Math.round(workArea.height * 0.9));

  mainWindow = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - initialWidth) / 2),
    y: Math.round(workArea.y + (workArea.height - initialHeight) / 2),
    width: initialWidth,
    height: initialHeight,
    minWidth,
    minHeight,
    backgroundColor: '#1e1e1e',
    // Without it the taskbar/dock shows Electron's default icon when running unpackaged and on Linux window managers
    icon: getWindowIcon(),
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true
    },
  });

  const isDev = !app.isPackaged;

  mainWindow.webContents.on('before-input-event', (event, input) => {
    blockDefaultBrowserShortcuts(event, input);
  });

  mainWindow.on('focus', () => {
    if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed() && subtitlesLookupWindow.isVisible()) {
      subtitlesLookupWindow.hide();
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', false);
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-state-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-state-changed', false);
  });

  mainWindow.on('closed', () => {
    setDisplaySleepBlocked(false);
    void mpvManager?.stop();
    yomitanManager?.destroy();

    mainWindow = null;

    // Force the entire application to quit - this ensures all processes and windows are terminated.
    app.quit();
  });

  const showMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', showMainWindow);
  // An unmapped window does not paint on every Linux compositor, so ready-to-show may never fire
  mainWindow.webContents.once('did-finish-load', showMainWindow);

  mainWindow.loadFile(path.join(__dirname, './dist/yall-mp/browser/index.html'));

  if (isE2E) {
    // Read-only probe so e2e tests can inspect the window without URL heuristics
    (globalThis as any).__yallE2E = {
      getWindows: () => ({mainWindow}),
      getVideoStats: () => videoSender?.stats() ?? null,
      isDisplaySleepBlocked: () => displaySleepBlockerId !== null,
      simulateDeviceLost: () => videoSender?.simulateDeviceLost() ?? false,
      simulateEngineError: () => mpvManager?.emit('error', new Error('simulated engine failure')) ?? false,
      crashProcess: () => process.crash(),
      getCrashDumpsPath: () => app.getPath('crashDumps')
    };
  }

  if (isDev && !isE2E) {
    mainWindow.webContents.once('devtools-opened', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    });

    mainWindow.webContents.openDevTools({mode: 'detach'});
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Main] Second instance detected.');

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    const files = getFilesFromArgv(commandLine);

    if (files.length > 0) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:open-files', files);
        mainWindow.focus();
      } else {
        console.error('[Main] UI Window is missing or destroyed, cannot send files.');
      }
    } else {
      console.warn('[Main] No valid files found in command line arguments.');
    }
  });

  app.whenReady().then(async () => {
    // GUI-launched macOS apps don't inherit the shell PATH, so Homebrew binaries (mpv, audiowaveform) aren't found
    if (process.platform === 'darwin') {
      const currentPaths = (process.env.PATH || '').split(path.delimiter);
      const homebrewPaths = ['/opt/homebrew/bin', '/usr/local/bin'].filter(p => !currentPaths.includes(p));
      process.env.PATH = [...homebrewPaths, ...currentPaths].join(path.delimiter);
    }

    // The renderer asks for frames right after the project opens: have the active GPU known by then.
    gpuInfoPromise = app.getGPUInfo('complete').then(info => info as GpuInfoLike).catch(() => null);

    try {
      const configStr = await fs.readFile(APP_DATA_PATH, 'utf-8');
      const config = JSON.parse(configStr);
      if (config?.globalSettings) {
        customExecutables = {
          libmpv: config.globalSettings.customLibmpvPath,
          ffmpeg: config.globalSettings.customFfmpegPath,
          ffprobe: config.globalSettings.customFfprobePath,
          audiowaveform: config.globalSettings.customAudiowaveformPath
        };
      }
    } catch (e) {
      console.warn("[Main] Could not read custom executable paths on startup", e);
    }

    app.on('web-contents-created', (_, contents) => {
      contents.setWindowOpenHandler(({url}) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
          shell.openExternal(url);
        }
        // Deny the creation of a new Electron window
        return {action: 'deny'};
      });
    });

    yomitanManager = new YomitanManager();
    await yomitanManager.loadExtension();
    yomitanManager.registerHandlers();

    await checkSystemDependencies();
    ensureProjectsDirExists();
    pendingFilesToOpen = getFilesFromArgv(process.argv); // Handle "Open with"

    ipcMain.handle('dialog:openFile', (_, options) => handleFileOpen(options));
    ipcMain.handle('subtitle:parse', (_, projectId, filePath) => handleSubtitleParse(projectId, filePath));
    ipcMain.handle('media:getMetadata', (_, filePath) => handleGetMediaMetadata(filePath));
    ipcMain.handle('media:extractSubtitleTrack', (_, projectId, mediaPath, trackIndex) => handleExtractSubtitleTrack(projectId, mediaPath, trackIndex));
    ipcMain.handle('anki:check', () => invokeAnkiConnect('version'));
    ipcMain.handle('anki:getDeckNames', () => invokeAnkiConnect('deckNames'));
    ipcMain.handle('anki:getNoteTypes', () => invokeAnkiConnect('modelNames'));
    ipcMain.handle('anki:getNoteTypeFieldNames', (_, modelName) => invokeAnkiConnect('modelFieldNames', {modelName}));
    ipcMain.handle('anki:exportAnkiCardBatch', (_, batchRequest: AnkiBatchExportRequest) => handleAnkiBatchExport(batchRequest));
    ipcMain.handle('ffmpeg:check', async () => {
      await ensureFFmpegPaths();
      return isFFmpegAvailable;
    });
    ipcMain.handle('app:get-data', readAppData);
    ipcMain.handle('project:get-by-id', async (_, projectId: string) => {
      try {
        const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
        const projectFile = await fs.readFile(projectPath, 'utf-8');
        const project = JSON.parse(projectFile);

        try {
          const peaksPath = path.join(PROJECTS_DIR, `${projectId}.peaks.json`);
          const peaksFile = await fs.readFile(peaksPath, 'utf-8');
          project.audioPeaks = JSON.parse(peaksFile);
        } catch (e) {
          // Legacy support - if no separate audio peaks file, assume they are embedded in the main project file
        }

        return project;
      } catch (e) {
        console.error(`Could not load project file for ID ${projectId}.`, e);
        return null;
      }
    });

    ipcMain.handle('core-config:save', (_, coreConfig) => {
      coreConfigToSave = coreConfig;
      if (coreConfig?.globalSettings) {
        customExecutables = {
          libmpv: coreConfig.globalSettings.customLibmpvPath,
          ffmpeg: coreConfig.globalSettings.customFfmpegPath,
          ffprobe: coreConfig.globalSettings.customFfprobePath,
          audiowaveform: coreConfig.globalSettings.customAudiowaveformPath
        };
      }
      processSaveQueue();
    });

    ipcMain.handle('project:save', (_, project: Project) => {
      projectsToSave.set(project.id, project); // Map automatically handles overwriting with the latest data
      processSaveQueue();
    });

    ipcMain.handle('project:update-fields', async (_, projectId: string, fields: Partial<Project>) => {
      try {
        const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);

        // Read existing file
        let currentData: Project;
        if (projectsToSave.has(projectId)) {
          currentData = projectsToSave.get(projectId)!;
        } else {
          const fileContent = await fs.readFile(projectPath, 'utf-8');
          currentData = JSON.parse(fileContent);
        }

        // Patch fields
        const updatedData = {...currentData, ...fields};

        // Ensure audioPeaks are NEVER saved into the main file via partial update
        if ('audioPeaks' in updatedData) {
          delete updatedData.audioPeaks;
        }

        // Queue for saving
        projectsToSave.set(projectId, updatedData);
        processSaveQueue();
      } catch (e) {
        console.error('Failed to patch project fields', e);
      }
    });

    ipcMain.handle('project:delete-file', async (_, projectId: string) => {
      const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
      try {
        await fs.unlink(projectPath);
      } catch (error) {
        console.error(`Failed to delete project file for ${projectId}:`, error);
      }

      const peaksPath = path.join(PROJECTS_DIR, `${projectId}.peaks.json`);
      try {
        await fs.unlink(peaksPath);
      } catch (error: any) {
        // Ignore if the file doesn't exist (ENOENT), report other errors
        if (error.code !== 'ENOENT') {
          console.error(`Failed to delete peaks file for ${projectId}:`, error);
        }
      }
    });

    ipcMain.on('window:minimize', () => {
      mainWindow?.minimize();
    });

    ipcMain.on('window:toggle-maximize', () => {
      if (!mainWindow) {
        return;
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    });

    ipcMain.on('window:toggle-fullscreen', () => {
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
    });

    ipcMain.on('window:escape', () => {
      handleWindowEscape();
    });

    ipcMain.on('window:close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    });

    ipcMain.handle('app:openInSystemBrowser', async (_, url: string) => {
      // Security: Validate the URL protocol before opening
      if (url.startsWith('http:') || url.startsWith('https:')) {
        await shell.openExternal(url);
      } else {
        console.warn(`Blocked attempt to open non-http(s) URL: ${url}`);
      }
    });

    ipcMain.handle('lookup:open-window', async (_, data: {
      url: string,
      clipSubtitleId: string,
      originalSelection: string,
      automationText?: string
    }) => {
      const {url, clipSubtitleId, originalSelection, automationText} = data;
      currentSubtitlesLookupContext = {clipSubtitleId, originalSelection};

      const parentBounds = mainWindow!.getBounds();
      const lookupWidth = Math.round(parentBounds.width * 0.8);
      const lookupHeight = Math.round(parentBounds.height * 0.8);
      const lookupX = Math.round(parentBounds.x + (parentBounds.width - lookupWidth) / 2);
      const lookupY = Math.round(parentBounds.y + (parentBounds.height - lookupHeight) / 2);

      const TITLE_BAR_HEIGHT = 40; // 2.5rem
      const FOOTER_HEIGHT = 40; // 2.5rem

      // Destroy any existing view to ensure fresh state (no history leakage)
      if (subtitlesLookupView) {
        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
          if (subtitlesLookupWindow.contentView.children.includes(subtitlesLookupView)) {
            subtitlesLookupWindow.contentView.removeChildView(subtitlesLookupView);
          }
        }
        (subtitlesLookupView.webContents as any).destroy();
        subtitlesLookupView = null;
      }

      // Window setup - create or reuse
      if (!subtitlesLookupWindow || subtitlesLookupWindow.isDestroyed()) {
        subtitlesLookupWindow = new BrowserWindow({
          x: lookupX,
          y: lookupY,
          width: lookupWidth,
          height: lookupHeight,
          parent: mainWindow!,
          frame: false,
          show: false,
          title: 'Subtitles Lookup',
          backgroundColor: '#ffffff',
          webPreferences: {
            preload: path.join(__dirname, 'subtitles-lookup-host-preload.js')
          }
        });

        await subtitlesLookupWindow.loadFile(path.join(__dirname, './dist/yall-mp/browser/subtitles-lookup-host.html'));

        subtitlesLookupWindow.webContents.on('before-input-event', blockDefaultBrowserShortcuts);

        const handleClose = () => {
          if (subtitlesLookupView) {
            if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
              if (subtitlesLookupWindow.contentView.children.includes(subtitlesLookupView)) {
                subtitlesLookupWindow.contentView.removeChildView(subtitlesLookupView);
              }
            }
            subtitlesLookupView = null;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.focus();
          }
          notifyLookupWindowState(false);
        };

        subtitlesLookupWindow.on('hide', handleClose);

        subtitlesLookupWindow.on('close', (e) => {
          e.preventDefault();
          subtitlesLookupWindow?.hide();
          handleClose();
        });
      } else {
        // Update bounds if reusing existing window
        subtitlesLookupWindow.setBounds({x: lookupX, y: lookupY, width: lookupWidth, height: lookupHeight});
      }

      // Show spinner and text immediately
      subtitlesLookupWindow.webContents.send('lookup:nav-state-change', {canGoBack: false, canGoForward: false});
      subtitlesLookupWindow.webContents.send('lookup:loading-message', `Searching "${originalSelection}"...`);
      subtitlesLookupWindow.webContents.send('view:loading-state-change', true);
      subtitlesLookupWindow.show();
      subtitlesLookupWindow.focus();
      notifyLookupWindowState(true);

      // Always create new view
      const view = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, 'subtitles-lookup-preload.js'),
          devTools: !app.isPackaged,
          partition: LOOKUP_PARTITION
        }
      });
      subtitlesLookupView = view;
      let hasInitialLoadFailed = false;

      const updateNavState = () => {
        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed() && subtitlesLookupView) {
          subtitlesLookupWindow.webContents.send('lookup:nav-state-change', {
            canGoBack: subtitlesLookupView.webContents.canGoBack(),
            canGoForward: subtitlesLookupView.webContents.canGoForward()
          });
        }
      };

      view.webContents.on('did-navigate', updateNavState);
      view.webContents.on('did-navigate-in-page', updateNavState);

      view.webContents.on('did-finish-load', async () => {
        if (hasInitialLoadFailed) {
          return;
        }

        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
          subtitlesLookupWindow.webContents.send('view:loading-state-change', false);
          updateNavState();

          // Attach view only after load finishes to prevent white flash
          if (subtitlesLookupView === view) {
            if (!subtitlesLookupWindow.contentView.children.includes(view)) {
              subtitlesLookupWindow.contentView.addChildView(view);
            }
          }

          if (automationText) {
            try {
              // Ensure the webview itself has OS-level focus
              view.webContents.focus();

              // Wait until the loaded DOM actually focuses an input field
              const inputReady = await view.webContents.executeJavaScript(`
                (async () => {
                  const isTextData = (el) => {
                    if (!el) {
                      return false;
                    }
                    return el.isContentEditable ||
                           el.tagName === 'TEXTAREA' ||
                           (el.tagName === 'INPUT' && /^(text|search|url|tel|email)$/i.test(el.type));
                  };

                  // Check immediately
                  if (isTextData(document.activeElement)) {
                    return true;
                  }

                  // Poll every 100ms for up to 5 seconds
                  for (let i = 0; i < 50; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    if (isTextData(document.activeElement)) {
                      return true;
                    }
                  }

                  return false;
                })()
              `);

              if (inputReady) {
                // Insert the text into AI prompt input
                await view.webContents.insertText(automationText);
                console.log('[Lookup] Text injected into focused input.');
              } else {
                console.warn('[Lookup] Automation skipped: No input field was focused by the page.');
              }
            } catch (e) {
              console.error('[Lookup] Automation failed', e);
            }
          }
        }
      });

      view.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // Only show the error page if the main URL requested by user failed,
        // ignore failures from background resources like ads, trackers, iframes etc.
        if (!isMainFrame) {
          return;
        }

        if (errorCode !== -3) { // Ignore ABORTED
          hasInitialLoadFailed = true;
          console.error(`Lookup view failed: ${errorDescription} for URL: ${validatedURL}`);

          if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
            subtitlesLookupWindow.webContents.send('view:loading-state-change', false);
            subtitlesLookupWindow.webContents.send('lookup:load-error', {
              description: errorDescription,
              url: validatedURL
            });
          }

          // Remove the view if it was somehow attached already
          if (subtitlesLookupWindow?.contentView?.children?.includes(view)) {
            subtitlesLookupWindow.contentView.removeChildView(view);
          }
        }
      });

      const updateViewBounds = () => {
        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed() && subtitlesLookupView) {
          const [w, h] = subtitlesLookupWindow.getSize();
          subtitlesLookupView.setBounds({
            x: 0,
            y: TITLE_BAR_HEIGHT,
            width: w,
            height: h - TITLE_BAR_HEIGHT - FOOTER_HEIGHT
          });
        }
      };

      subtitlesLookupWindow.removeAllListeners('resize');
      subtitlesLookupWindow.on('resize', updateViewBounds);

      updateViewBounds();

      view.webContents.loadURL(url, USER_AGENT_OPTIONS).catch(err => {
        if (err.code !== 'ERR_ABORTED') {
          console.error(`Initial lookup for URL ${url} failed:`, err);
        }
      });
    });

    ipcMain.on('lookup:go-back', () => {
      if (subtitlesLookupView && subtitlesLookupView.webContents.canGoBack()) {
        subtitlesLookupView.webContents.goBack();
      }
    });

    ipcMain.on('lookup:go-forward', () => {
      if (subtitlesLookupView && subtitlesLookupView.webContents.canGoForward()) {
        subtitlesLookupView.webContents.goForward();
      }
    });

    ipcMain.on('lookup:close-window', () => {
      subtitlesLookupWindow?.hide();
      if (subtitlesLookupWindow) {
        subtitlesLookupWindow.emit('hide');
      }
      notifyLookupWindowState(false);
    });

    ipcMain.on('lookup:show-context-menu', (_, selectedText) => {
      const template = [
        {
          label: 'Add to Notes',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && currentSubtitlesLookupContext && selectedText) {
              mainWindow.webContents.send('project:add-note', {
                clipSubtitleId: currentSubtitlesLookupContext.clipSubtitleId,
                text: selectedText,
                selection: currentSubtitlesLookupContext.originalSelection
              });
              if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
                subtitlesLookupWindow.webContents.send('lookup:show-toast', 'Note added!');
              }
            } else {
              console.error('[Main Process] Could not send note: mainWindow or context is missing.');
            }
          }
        }
      ];
      const menu = Menu.buildFromTemplate(template);
      const parentWindow = subtitlesLookupWindow ?? undefined;
      menu.popup({window: parentWindow});
    });

    ipcMain.on('lookup:add-note', (_, {text}) => {
      if (mainWindow && !mainWindow.isDestroyed() && currentSubtitlesLookupContext) {
        mainWindow.webContents.send('project:add-note', {
          clipSubtitleId: currentSubtitlesLookupContext.clipSubtitleId,
          text: text,
          selection: currentSubtitlesLookupContext.originalSelection
        });
        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
          subtitlesLookupWindow.webContents.send('lookup:show-toast', 'Note added!');
        }
      } else {
        console.error('[Main Process] Could not forward note: mainWindow or context is missing.');
      }
    });

    ipcMain.handle('mpv:createViewport', async (
      _,
      mediaPath: string,
      audioTrackIndex: number | null,
      subtitleSelection: SubtitleSelection,
      subtitleTracks: MediaTrack[],
      useMpvSubtitles: boolean,
      subtitlesVisible: boolean,
      hardwareAcceleration: boolean,
      volume: number,
      isMuted: boolean
    ) => {
      if (!mainWindow) {
        return;
      }

      hasRequestedInitialSeek = false;
      gpuLossSinceOpen = 0;
      engineRestartPolicy.reset();

      // Clean up any old instance
      setDisplaySleepBlocked(false);
      await mpvManager?.stop();

      viewportArgs = {
        mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible,
        hardwareAcceleration, volume, isMuted
      };
      await launchEngine(viewportArgs);
    });

    ipcMain.on(PROBE_REPORT_CHANNEL, (event, black: unknown) => {
      if (typeof black === 'boolean' && event.sender === mainWindow?.webContents) {
        videoSender?.reportPageProbe(black);
      }
    });

    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'GPU' && details.reason !== 'clean-exit') {
        gpuLossCount++;
        gpuLossSinceOpen++;
        logVideo(`[Main Process] GPU process gone (${details.reason}, exit code ${details.exitCode}), loss #${gpuLossCount} of this run`);
        videoSender?.gpuProcessGone(details.reason);
      }
    });

    ipcMain.on('video:set-canvas-size', (_, width: unknown, height: unknown) => {
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)
        || width < 2 || height < 2 || width > 8192 || height > 8192) {
        return;
      }
      videoCanvasSize = {width: Math.round(width), height: Math.round(height)};
      videoSender?.setCanvasSize(videoCanvasSize.width, videoCanvasSize.height);
    });

    ipcMain.handle('mpv:command', (_, commandArray) => {
      console.log('[Main Process]  Received mpv:command:', commandArray);
      mpvManager?.sendCommand(commandArray);
    });

    ipcMain.handle('mpv:getProperty', async (_, property) => {
      const value = await mpvManager?.getProperty(property);
      console.log(`[Main Process] Received mpv:getProperty: ${property}=${value}`);
      return value;
    });

    ipcMain.handle('mpv:setProperty', (_, property, value) => {
      console.log(`[Main Process] Received mpv:setProperty: ${property}=${value}`);
      mpvManager?.setProperty(property, value);
    });

    ipcMain.handle('mpv:showSubtitles', () => mpvManager?.showSubtitles());
    ipcMain.handle('mpv:hideSubtitles', () => mpvManager?.hideSubtitles());

    ipcMain.handle('mpv:destroyViewport', async () => {
      console.log('[Main Process] Received mpv:destroyViewport. Cleaning up.');

      setDisplaySleepBlocked(false);
      await mpvManager?.stop();
      mpvManager = null;
      playbackManager = null;
      viewportArgs = null;

      // Cleanup subtitles lookup window if open
      if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
        subtitlesLookupWindow.destroy();
      }
      subtitlesLookupWindow = null;
      subtitlesLookupView = null;

    });

    ipcMain.handle('fonts:get-fonts', async (_, projectId: string) => {
      try {
        const fontFilePath = path.join(FONT_CACHE_DIR, `${projectId}.json`);
        const data = await fs.readFile(fontFilePath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        // It's normal for a file not to exist if a project has no ASS subtitles
        return [];
      }
    });

    ipcMain.on('fonts:delete-fonts', async (_, projectId: string) => {
      try {
        const fontFilePath = path.join(FONT_CACHE_DIR, `${projectId}.json`);
        await fs.unlink(fontFilePath);
      } catch (error) {
        // Ignore errors if the file doesn't exist
      }
    });

    ipcMain.handle('project:generate-audio-peaks', async (_, projectId, mediaPath, audioTrackIndex) => generateAudioPeaks(projectId, mediaPath, audioTrackIndex));

    ipcMain.handle('fs:check-file-exists', async (_, filePath: string) => {
      if (!filePath) return false;
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.on('playback:play', () => playbackManager?.play());
    ipcMain.on('playback:pause', () => playbackManager?.pause());
    ipcMain.on('playback:togglePlayPause', () => playbackManager?.togglePlayPause());
    ipcMain.on('playback:toggleSubtitles', () => playbackManager?.toggleSubtitles());
    ipcMain.on('playback:repeat', () => playbackManager?.repeat());
    ipcMain.on('playback:forceContinue', () => playbackManager?.forceContinue());
    ipcMain.on('playback:seek', (_, time, isNavigation) => {
      // The first seek is the resume position: the page waits for the frame it produces
      if (!hasRequestedInitialSeek) {
        hasRequestedInitialSeek = true;
        initialSeekFrameBaseline = videoSender?.stats().sent ?? 0;
      }
      playbackManager?.seek(time, isNavigation);
    });
    ipcMain.on('playback:updateSettings', (_, settings) => {
      playbackManager?.updateSettings(settings);
    });
    ipcMain.on('playback:updateClips', (_, clips, currentTime) => {
      playbackManager?.updateClips(clips, currentTime);
    });
    ipcMain.on('playback:setCinemaMode', (_, options) => {
      playbackManager?.setCinemaMode(options);
    });
    ipcMain.handle('playback:loadProject', (_, clips, settings, lastPlaybackTime, cinemaMode) => playbackManager?.loadProject(clips, settings, lastPlaybackTime, cinemaMode));
    ipcMain.on('playback:setSpeedOverride', (_, isActive: boolean) => {
      playbackManager?.setSpeedOverride(isActive);
    });
    ipcMain.on('playback:setVolume', (_, volume: number) => playbackManager?.setVolume(volume));
    ipcMain.on('playback:setMute', (_, mute: boolean) => playbackManager?.setMute(mute));

    ipcMain.handle('app:get-version', () => app.getVersion());

    ipcMain.on('app:set-theme', (_, theme: 'system' | 'light' | 'dark') => {
      nativeTheme.themeSource = theme;
    });

    ipcMain.handle('app:get-pending-files', () => {
      const files = [...pendingFilesToOpen];
      pendingFilesToOpen = []; // Clear after retrieval
      return files;
    });

    const naturalSort = (a: string, b: string) => {
      return new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'}).compare(a, b);
    };

    ipcMain.handle('fs:find-adjacent-media', async (_, currentPath: string, direction: 'next' | 'previous') => {
      try {
        const currentDir = path.dirname(currentPath);
        const currentFileName = path.basename(currentPath);

        // Search for siblings (same directory)
        const siblings = await fs.readdir(currentDir);
        const mediaSiblings = siblings.filter(f => {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          return SUPPORTED_MEDIA_TYPES.includes(ext);
        }).sort(naturalSort);

        const currentIndex = mediaSiblings.indexOf(currentFileName);
        const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        // If found in same folder, return it
        if (targetIndex >= 0 && targetIndex < mediaSiblings.length) {
          return path.join(currentDir, mediaSiblings[targetIndex]);
        }

        // Search for siblings (e.g., folder per episode support)
        // Only attempt this if user is at the edge of the current folder
        // ("Next" on the last file or "Prev" on the first file)
        const parentDir = path.dirname(currentDir);
        const parentItems = await fs.readdir(parentDir);

        // Get all directories in the parent folder
        const siblingDirs = parentItems.filter(item => {
          try {
            return statSync(path.join(parentDir, item)).isDirectory();
          } catch {
            return false;
          }
        }).sort(naturalSort);

        const currentDirName = path.basename(currentDir);
        const currentDirIndex = siblingDirs.indexOf(currentDirName);

        if (currentDirIndex === -1) {
          return null;
        }

        const targetDirIndex = direction === 'next' ? currentDirIndex + 1 : currentDirIndex - 1;

        if (targetDirIndex >= 0 && targetDirIndex < siblingDirs.length) {
          const targetDirName = siblingDirs[targetDirIndex];
          const targetDirPath = path.join(parentDir, targetDirName);

          // Look inside the next folder
          const targetDirFiles = await fs.readdir(targetDirPath);
          const targetMediaFiles = targetDirFiles.filter(f => {
            const ext = path.extname(f).toLowerCase().replace('.', '');
            return SUPPORTED_MEDIA_TYPES.includes(ext);
          }).sort(naturalSort);

          if (targetMediaFiles.length > 0) {
            // If going "Next", play the first file of the next folder.
            // If going "Previous", play the last file of the previous folder.
            const fileIndex = direction === 'next' ? 0 : targetMediaFiles.length - 1;
            return path.join(targetDirPath, targetMediaFiles[fileIndex]);
          }
        }

        return null;
      } catch (e) {
        console.error('Error finding adjacent media:', e);
        return null;
      }
    });

    ipcMain.handle('fs:find-companion-subtitle', async (_, mediaPath: string) => {
      try {
        const dir = path.dirname(mediaPath);
        const nameNoExt = path.parse(mediaPath).name;
        const files = await fs.readdir(dir);

        const candidates = files.filter(f => {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          if (!SUPPORTED_SUBTITLE_TYPES.includes(ext)) {
            return false;
          }
          return f.startsWith(nameNoExt); // Basic check
        });

        // Sort candidates by length (shortest matching name is usually the "main" subtitle)
        // e.g., "Movie.srt" is preferred over "Movie.commentary.srt"
        candidates.sort((a, b) => a.length - b.length);

        if (candidates.length > 0) {
          return path.join(dir, candidates[0]);
        }
        return null;
      } catch (e) {
        return null;
      }
    });

    ipcMain.handle('lookup:clear-data', async () => {
      const ses = session.fromPartition(LOOKUP_PARTITION);
      await ses.clearStorageData();
      console.log('[Main] Lookup session data cleared.');
    });

    // Disable the default menu bar and its associated shortcuts
    Menu.setApplicationMenu(null);

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Electron 43+ opens file dialogs in Downloads instead of the last used folder, so remember it ourselves.
async function readLastDialogDirectory(): Promise<string | undefined> {
  try {
    const state = JSON.parse(await fs.readFile(DIALOG_STATE_PATH, 'utf-8'));
    if (typeof state.lastDirectory === 'string' && statSync(state.lastDirectory).isDirectory()) {
      return state.lastDirectory;
    }
  } catch {
    // No saved state yet, or the folder is gone.
  }
  return undefined;
}

async function handleFileOpen(options: Electron.OpenDialogOptions) {
  const defaultPath = options.defaultPath ?? await readLastDialogDirectory();
  const {canceled, filePaths} = await dialog.showOpenDialog({...options, defaultPath});
  if (!canceled) {
    if (filePaths.length > 0) {
      fs.writeFile(DIALOG_STATE_PATH, JSON.stringify({lastDirectory: path.dirname(filePaths[0])}), 'utf-8')
        .catch(err => console.warn('[Main] Failed to save the last dialog directory:', err));
    }
    return filePaths;
  }
  return [];
}

function cleanSrtText(text: string): string {
  if (!text) {
    return '';
  }

  return text
    // Remove ASS/SSA style override tags (e.g. {\an8}, {\pos(20,50)}, {\c&HFFFFFF&})
    .replace(/\{[^}]+}/g, '')
    // Replace literal ASS newlines (\N) and HTML breaks (<br>) into real newlines (\n)
    .replace(/\\N/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Clean up WebVTT-style voice tags <v Name> or <c.class>
    .replace(/<[vc][^>]*>/g, '')
    .replace(/<\/[vc]>/g, '')
    // Remove control codes like left-to-right marks if present
    .replace(/[\u200E\u200F]/g, '')
    .trim();
}

async function handleSubtitleParse(projectId: string, filePath: string): Promise<ParsedSubtitlesData> {
  const {parseResponse} = await import('media-captions');
  const {compile, parse} = await import('ass-compiler');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.ass' || extension === '.ssa') {
      // Ensure the font cache directory exists
      await fs.mkdir(FONT_CACHE_DIR, {recursive: true});

      const parsed = parse(content);
      const compiled = compile(content, {});
      const playResY = compiled.info.PlayResY ? parseInt(compiled.info.PlayResY, 10) : 1080;
      const granularTimeline = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, playResY);
      const karaokeMergedTimeline = mergeKaraokeSubtitles(granularTimeline, parsed.events);
      const finalTimeline = mergeIdenticalConsecutiveSubtitles(karaokeMergedTimeline);
      const subtitlesWithTracks = assignTracksToSubtitles(finalTimeline);
      const requiredFonts = getRequiredFontsFromAss(content);
      const fonts = await loadFontData(requiredFonts, undefined, filePath);
      const fullText = getFullTextFromSubtitles(finalTimeline);
      const detectedLanguage = await detectLanguage(fullText);

      await fs.writeFile(path.join(FONT_CACHE_DIR, `${projectId}.json`), JSON.stringify(fonts));

      return {
        subtitles: subtitlesWithTracks,
        rawAssContent: content,
        styles: compiled.styles,
        detectedLanguage
      };
    } else {
      const response = new Response(content);
      const fileFormat = extension.replace('.', '');
      const result: ParsedCaptionsResult = await parseResponse(response, {type: fileFormat as CaptionsFileFormat});
      if (result.errors.length > 0) {
        console.warn('Encountered errors parsing subtitle file:', result.errors);
      }
      const subtitles: SrtSubtitleData[] = result.cues.map((cue: VTTCue) => ({
        type: 'srt',
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cleanSrtText(cue.text),
        track: 0
      }));
      const processedSubtitles = preprocessSubtitles(subtitles);
      const fullText = getFullTextFromSubtitles(processedSubtitles);
      const detectedLanguage = await detectLanguage(fullText);

      return {
        subtitles: processedSubtitles,
        detectedLanguage
      };
    }
  } catch (error) {
    console.error(`Error reading or parsing subtitle file at ${filePath}:`, error);
    return {
      subtitles: [],
      detectedLanguage: 'other'
    };
  }
}

function preprocessSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  const sortedSubtitles = [...subtitles].sort((a, b) => a.startTime - b.startTime);

  if (sortedSubtitles.length === 0) {
    return [];
  }

  sortedSubtitles.forEach((sub: SubtitleData, i: number) => {
    if (i > 0) {
      const previousSubtitle = sortedSubtitles[i - 1];

      // If there's an overlap, truncate the previous subtitle
      if (sub.startTime < previousSubtitle.endTime) {
        previousSubtitle.endTime = sub.startTime;
      }

      // Prevent identical consecutive subtitles from merging visually on the timeline if the gap is closed later
      if (sub.type === 'srt' && previousSubtitle.type === 'srt' && sub.text === previousSubtitle.text) {
        previousSubtitle.splitGroupId = previousSubtitle.splitGroupId || uuidv4();
        sub.splitGroupId = sub.splitGroupId || uuidv4();
      }
    }
  });

  // Filter out any subtitles that may have become zero-duration or negative-duration as a result of the truncation
  return sortedSubtitles.filter(sub => sub.endTime > sub.startTime);
}

async function invokeAnkiConnect(action: string, params = {}) {
  try {
    const response = await fetch('http://localhost:8765', {
      method: 'POST',
      body: JSON.stringify({action, version: 6, params})
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  } catch (e) {
    console.error(`AnkiConnect action '${action}' failed:`, e);
    return null;
  }
}

async function storeMediaFileInAnki(filePath: string): Promise<string | null> {
  try {
    // Verify file was in fact created (FFmpeg didn't silently fail to output)
    await fs.access(filePath);

    // Send to Anki
    const storedFilename = await invokeAnkiConnect('storeMediaFile', {
      filename: path.basename(filePath),
      path: filePath
    });

    return storedFilename || null;
  } catch (err) {
    console.warn(`[Anki Export] Failed to store media (${path.basename(filePath)}):`, err);
    return null;
  }
}

async function handleAnkiBatchExport(request: AnkiBatchExportRequest) {
  await ensureFFmpegPaths();

  if (!isFFmpegAvailable) {
    return {cardId: null, error: 'FFmpeg is not available, cannot export media.'};
  }

  const {subtitleData, mediaPath, exportTime, hint, notes, suspend, targets, audioTrackIndex} = request;
  const tempDir = os.tmpdir();
  const uniqueBatchId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const generatedFiles: string[] = [];
  const mediaCache = new Map<AnkiFieldMappingSource, string>();

  // Identify which media types are needed across ALL templates
  const requiredMediaTypes = new Set<AnkiFieldMappingSource>();
  for (const target of targets) {
    for (const mapping of target.template.fieldMappings) {
      if (['audio', 'video', 'screenshot', 'animation'].includes(mapping.source)) {
        requiredMediaTypes.add(mapping.source);
      }
    }
  }

  let hasRealVideoStream = false;

  if (requiredMediaTypes.has('video') || requiredMediaTypes.has('screenshot') || requiredMediaTypes.has('animation')) {
    try {
      const probeResult = await runFfprobe([
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        mediaPath
      ]);

      if (probeResult.streams) {
        // Check for video stream that isn't a 1-frame static image (e.g., album art, audiobook cover etc.)
        hasRealVideoStream = probeResult.streams.some((s: any) =>
          s.codec_type === 'video' && s.disposition?.attached_pic !== 1
        );
      }
    } catch (e) {
      console.warn('Failed to probe media during Anki export', e);
    }
  }

  try {
    if (requiredMediaTypes.has('audio')) {
      const audioPath = path.join(tempDir, `${uniqueBatchId}.mp3`);
      generatedFiles.push(audioPath);

      const audioArgs = [
        '-ss', subtitleData.startTime.toString(), // Start time
        '-to', subtitleData.endTime.toString(),   // End time
        '-i', mediaPath                           // Input file
      ];

      if (audioTrackIndex != null) {
        audioArgs.push(
          '-map', `0:${audioTrackIndex}`          // Audio track index
        );
      }

      audioArgs.push(
        '-vn',                                    // No video
        '-acodec', 'libmp3lame',                  // Use MP3 codec
        '-ac', '2',                               // Downmix to stereo (lame can't encode >2 channels)
        '-q:a', '2',                              // Audio quality (VBR)
        audioPath
      );

      await runFFmpeg(audioArgs);

      const storedName = await storeMediaFileInAnki(audioPath);
      if (storedName) {
        mediaCache.set('audio', `[sound:${storedName}]`);
      }
    }

    if (hasRealVideoStream) {
      if (requiredMediaTypes.has('screenshot')) {
        const imagePath = path.join(tempDir, `${uniqueBatchId}.jpg`);
        generatedFiles.push(imagePath);

        const imageArgs = [
          '-ss', exportTime.toString(), // Go to the start time of the clip
          '-i', mediaPath,              // Input file
          '-vframes', '1',              // Take just one frame
          '-q:v', '2',                  // Image quality
          imagePath
        ];

        await runFFmpeg(imageArgs);

        const storedName = await storeMediaFileInAnki(imagePath);
        if (storedName) {
          mediaCache.set('screenshot', `<img src="${storedName}">`);
        }
      }

      if (requiredMediaTypes.has('video')) {
        const videoPath = path.join(tempDir, `${uniqueBatchId}.webm`);
        generatedFiles.push(videoPath);

        const videoArgs = [
          '-ss', subtitleData.startTime.toString(), // Start time
          '-to', subtitleData.endTime.toString(),   // End time
          '-i', mediaPath,                          // Input file
        ];

        if (audioTrackIndex != null) {
          videoArgs.push(
            '-map', '0:v:0',                        // Video track index
            '-map', `0:${audioTrackIndex}`          // Audio track index
          );
        }

        videoArgs.push(
          '-c:v', 'libvpx-vp9',                     // VP9 video codec
          '-crf', '32',                             // Constant Rate Factor for VP9
          '-b:v', '0',                              // Must be 0 when using CRF
          '-vf', 'scale=-2:480',                    // Scale to 480p height to keep size down
          '-c:a', 'libopus',                        // Opus audio codec
          '-ac', '2',                               // Downmix to stereo (libopus fails on 5.1(side) layouts)
          '-b:a', '96k',                            // Audio bitrate
          videoPath
        );

        await runFFmpeg(videoArgs);

        const storedName = await storeMediaFileInAnki(videoPath);
        if (storedName) {
          mediaCache.set('video', `<video controls playsinline autoplay src="${storedName}"></video>`);
        }
      }

      if (requiredMediaTypes.has('animation')) {
        const avifPath = path.join(tempDir, `${uniqueBatchId}.avif`);
        generatedFiles.push(avifPath);

        const avifArgs = [
          '-ss', subtitleData.startTime.toString(),
          '-to', subtitleData.endTime.toString(),
          '-i', mediaPath,
          '-vf', 'scale=-2:480,fps=15', // Resize to 480p height and reduce framerate to keep the file size small
          '-c:v', 'libaom-av1',         // AV1 video codec
          '-crf', '35',                 // Constant Rate Factor for AV1
          '-b:v', '0',                  // Must be 0 when using CRF
          '-cpu-used', '8',             // Maximum speed in the range of 0-8 (8 is fastest - crucial for UX as AV1 is slow)
          '-row-mt', '1',               // Enable row-based multi-threading to utilize all CPU cores
          '-an',                        // No audio
          avifPath
        ];

        await runFFmpeg(avifArgs);

        const storedName = await storeMediaFileInAnki(avifPath);
        if (storedName) {
          mediaCache.set('animation', `<img src="${storedName}">`);
        }
      }
    }
  } catch (error: any) {
    console.error('Anki media generation failed:', error);
    // Cleanup files that might have been created before failure
    for (const file of generatedFiles) {
      await fs.unlink(file).catch(e => console.error(`Failed to delete temp file: ${file}`, e));
    }
    return {successCount: 0, error: `Media generation failed: ${error.message}`};
  }

  // Create flashcards using cached media
  let successCount = 0;
  let lastError = '';

  for (const target of targets) {
    const finalFields: Record<string, string> = {};
    const {template, tags} = target;

    for (const mapping of template.fieldMappings) {
      if (mediaCache.has(mapping.source)) {
        finalFields[mapping.destination] = mediaCache.get(mapping.source)!;
        continue;
      }

      switch (mapping.source) {
        case 'id':
          finalFields[mapping.destination] = uuidv4();
          break;
        case 'text':
          if (subtitleData.type === 'srt') {
            finalFields[mapping.destination] = (subtitleData.text || '')
              .replace(/\n/g, '<br>');
          } else { // 'ass'
            finalFields[mapping.destination] = (subtitleData.parts || [])
              .map(p => (p.text || '').replace(/\n/g, '<br>'))
              .join('<br>');
          }
          break;
        case 'notes':
          finalFields[mapping.destination] = notes;
          break;
        case 'hint':
          finalFields[mapping.destination] = hint || '';
          break;
      }
    }

    const note: AnkiCard = {
      deckName: template.ankiDeck!,
      modelName: template.ankiNoteType!,
      fields: finalFields,
      tags,
      options: {
        allowDuplicate: true
      }
    };

    try {
      const cardId = await invokeAnkiConnect('addNote', {note});
      if (cardId) {
        if (suspend) {
          const suspendResult = await invokeAnkiConnect('suspend', {cards: [cardId]});
          if (suspendResult) {
            console.log(`[Anki Export] Suspended new card: ${cardId}`);
          }
        }
        successCount++;
      } else {
        lastError = 'Failed to add specific note to Anki.';
      }
    } catch (e: any) {
      console.error(`Failed to add note for template ${template.name}`, e);
      lastError = e.message;
    }
  }

  // Cleanup temp files
  for (const file of generatedFiles) {
    await fs.unlink(file).catch(e => console.error(`Failed to delete temp file: ${file}`, e));
  }

  return {
    successCount,
    error: successCount === 0 ? (lastError || 'Unknown error') : undefined
  };
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args);

    let errorOutput = '';
    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`FFmpeg exited with code ${code}`);
        console.error('FFmpeg stderr:', errorOutput);
        reject(new Error(`FFmpeg failed: ${errorOutput}`));
      }
    });

    process.on('error', (err) => {
      console.error('Failed to start FFmpeg process.', err);
      reject(err);
    });
  });
}

async function runFfprobe(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const process: ChildProcess = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse ffprobe output.'));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}

async function handleGetMediaMetadata(filePath: string) {
  await ensureFFmpegPaths();

  if (!isFFmpegAvailable) {
    return {audioTracks: [], subtitleTracks: []};
  }

  try {
    const probeResult = await runFfprobe([
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath
    ]);

    const audioTracks: MediaTrack[] = [];
    const subtitleTracks: MediaTrack[] = [];
    let videoWidth: number | undefined;
    let videoHeight: number | undefined;

    if (probeResult && probeResult.streams) {
      for (const stream of probeResult.streams) {
        const baseTrack = {
          index: stream.index,
          language: stream.tags?.language,
          title: stream.tags?.title
        };

        const {label, code} = getLanguageInfo(baseTrack);
        const codec = stream.codec_name?.toLowerCase() || 'unknown';
        const isSupported = SUPPORTED_TEXT_SUBTITLE_CODECS.includes(codec);

        const finalTrack: MediaTrack = {
          ...baseTrack,
          label: label,
          languageCode: code,
          codec: codec,
          isSupported: isSupported
        };

        if (stream.codec_type === 'video') {
          videoWidth = stream.width;
          videoHeight = stream.height;
        } else if (stream.codec_type === 'audio') {
          audioTracks.push(finalTrack);
        } else if (stream.codec_type === 'subtitle') {
          subtitleTracks.push(finalTrack);
        }
      }
    }
    return {audioTracks, subtitleTracks, videoWidth, videoHeight};
  } catch (error) {
    console.error('Error probing media file:', error);
    return {audioTracks: [], subtitleTracks: [], videoWidth: undefined, videoHeight: undefined};
  }
}

async function handleExtractSubtitleTrack(projectId: string, mediaPath: string, trackIndex: number): Promise<ParsedSubtitlesData> {
  const {parseResponse} = await import('media-captions');
  const {compile, parse} = await import('ass-compiler');
  await ensureFFmpegPaths();

  return new Promise(async (resolve, reject) => {
    const probeResult = await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_streams', mediaPath]);
    const subtitleStream = probeResult.streams.find((s: any) => s.index === trackIndex);
    const codec = subtitleStream?.codec_name;
    let outputFormat = 'srt';
    if (codec === 'ass' || codec === 'ssa') {
      outputFormat = 'ass';
    }
    const args = ['-i', mediaPath, '-map', `0:${trackIndex}`, '-c:s', outputFormat, '-f', outputFormat, '-'];
    const ffmpegProcess = spawn(ffmpegPath, args);
    let subtitleContent = '';
    ffmpegProcess.stdout.on('data', (data) => {
      subtitleContent += data.toString();
    });
    let errorOutput = '';
    ffmpegProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    ffmpegProcess.on('error', (err) => {
      reject(err);
    });

    ffmpegProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          if (outputFormat === 'ass') {
            // Ensure the font cache directory exists
            await fs.mkdir(FONT_CACHE_DIR, {recursive: true});

            const parsed = parse(subtitleContent);
            const compiled = compile(subtitleContent, {});
            const playResY = compiled.info.PlayResY ? parseInt(compiled.info.PlayResY, 10) : 1080;
            const granularTimeline = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, playResY);
            const karaokeMergedTimeline = mergeKaraokeSubtitles(granularTimeline, parsed.events);
            const finalTimeline = mergeIdenticalConsecutiveSubtitles(karaokeMergedTimeline);
            const subtitlesWithTracks = assignTracksToSubtitles(finalTimeline);
            const requiredFonts = getRequiredFontsFromAss(subtitleContent);
            const fonts = await loadFontData(requiredFonts, mediaPath, undefined);
            const fullText = getFullTextFromSubtitles(finalTimeline);
            const detectedLanguage = await detectLanguage(fullText);

            await fs.writeFile(path.join(FONT_CACHE_DIR, `${projectId}.json`), JSON.stringify(fonts));

            resolve({
              subtitles: subtitlesWithTracks,
              rawAssContent: subtitleContent,
              styles: compiled.styles,
              detectedLanguage
            });
          } else {
            const response = new Response(subtitleContent);
            const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
            if (result.errors.length > 0) {
              console.warn('Encountered errors parsing extracted subtitle stream:', result.errors);
            }
            const subtitles: SrtSubtitleData[] = result.cues.map((cue: VTTCue) => ({
              type: 'srt',
              id: cue.id,
              startTime: cue.startTime,
              endTime: cue.endTime,
              text: cleanSrtText(cue.text),
              track: 0
            }));
            const processedSubtitles = preprocessSubtitles(subtitles);
            const fullText = getFullTextFromSubtitles(processedSubtitles);
            const detectedLanguage = await detectLanguage(fullText);

            resolve({
              subtitles: processedSubtitles,
              detectedLanguage
            });
          }
        } catch (e) {
          reject(new Error(`Failed to parse extracted subtitle stream: ${e}`));
        }
      } else {
        reject(new Error(`ffmpeg failed to extract subtitle track with code ${code}: ${errorOutput}`));
      }
    });
  });
}

function getLanguageInfo(track: Omit<MediaTrack, 'label' | 'code'>): { label: string, code?: string } {
  const languages = require('@cospired/i18n-iso-languages');

  const originalCode = track.language;
  let langName: string | undefined = '';
  let standardCode: string | undefined;

  if (originalCode) {
    if (languages.isValid(originalCode)) {
      langName = languages.getName(originalCode, 'en');
      standardCode = languages.toAlpha2(originalCode);
    }
  }

  const title = track.title;
  let displayLabel: string;

  if (langName && title) {
    displayLabel = `${langName}, ${title}`;
  } else if (langName) {
    displayLabel = langName;
  } else if (title) {
    displayLabel = title;
  } else if (originalCode) {
    displayLabel = `Unknown Language (${originalCode.toUpperCase()})`;
  } else {
    displayLabel = `Track ${track.index}`;
  }

  return {label: displayLabel, code: standardCode};
}

async function readAppData(): Promise<AppData | null> {
  try {
    const coreConfigFile = await fs.readFile(APP_DATA_PATH, 'utf-8');
    const coreConfig: CoreConfig = JSON.parse(coreConfigFile);

    if (!coreConfig) {
      return null;
    }

    let currentProject: Project | null = null;
    if (coreConfig.lastOpenedProjectId) {
      try {
        const projectPath = path.join(PROJECTS_DIR, `${coreConfig.lastOpenedProjectId}.json`);
        const projectFile = await fs.readFile(projectPath, 'utf-8');
        currentProject = JSON.parse(projectFile);

        try {
          const peaksPath = path.join(PROJECTS_DIR, `${coreConfig.lastOpenedProjectId}.peaks.json`);
          const peaksFile = await fs.readFile(peaksPath, 'utf-8');
          currentProject!.audioPeaks = JSON.parse(peaksFile);
        } catch (e) {
          // No peaks file found (legacy project)
        }

      } catch (e) {
        console.warn(`Could not load last opened project file for ID ${coreConfig.lastOpenedProjectId}. It may have been deleted.`);
      }
    }

    return {
      projects: coreConfig.projects || [],
      currentProject,
      globalSettings: coreConfig.globalSettings,
      ankiSettings: coreConfig.ankiSettings,
      catalogs: coreConfig.catalogs || [],
      lastActiveCatalogId: coreConfig.lastActiveCatalogId
    };
  } catch (error) {
    console.log('Could not read app data (file might not exist yet). Returning null.');
    return null;
  }
}

async function ensureProjectsDirExists() {
  try {
    await fs.mkdir(PROJECTS_DIR, {recursive: true});
  } catch (error) {
    console.error('Failed to create projects directory:', error);
  }
}

async function processSaveQueue() {
  if (isSaving) {
    return;
  }

  isSaving = true;

  try {
    // Prioritize saving core config
    if (coreConfigToSave) {
      const configData = coreConfigToSave;
      await fs.writeFile(APP_DATA_PATH, JSON.stringify(configData, null, 2), 'utf-8');
      coreConfigToSave = null;
    }

    // Save one project from the queue
    if (projectsToSave.size > 0) {
      const [[projectId, projectData]] = projectsToSave; // Destructure 1st entry from map of projects
      const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);

      // Extract peaks
      let peaksToWrite: number[][] | undefined = undefined;
      const projectAny = projectData as any; // Cast to allow attribute deletion

      if (projectAny.audioPeaks) {
        peaksToWrite = projectAny.audioPeaks;
        delete projectAny.audioPeaks;
      }

      // Save project data without peaks
      await fs.writeFile(projectPath, JSON.stringify(projectData, null, 2), 'utf-8');

      // Save peaks if present
      if (peaksToWrite) {
        const peaksPath = path.join(PROJECTS_DIR, `${projectId}.peaks.json`);
        await fs.writeFile(peaksPath, JSON.stringify(peaksToWrite), 'utf-8');
      }

      projectsToSave.delete(projectId);
    }
  } catch (error) {
    console.error('Failed during save operation:', error);
  } finally {
    isSaving = false;
    // If there are more items, process them in the next tick
    if (coreConfigToSave || projectsToSave.size > 0) {
      process.nextTick(processSaveQueue);
    }
  }
}

function getRequiredFontsFromAss(assContent: string): RequiredFont[] {
  const requiredFonts = new Map<string, RequiredFont>(); // Use a map to store unique font styles

  const addFont = (family: string, bold: boolean, italic: boolean) => {
    const key = `${family}-${bold}-${italic}`;
    if (!requiredFonts.has(key)) {
      requiredFonts.set(key, {family, bold, italic});
    }
  };

  const stylesSection = assContent.match(/\[V4\+ Styles\]\s*([\s\S]*?)(?=\s*\[|$)/i);
  if (stylesSection) {
    // Format: Name, Fontname, Fontsize, ..., Bold, Italic, ...
    const styleLines = stylesSection[1].split('\n').filter(line => line.toLowerCase().startsWith('style:'));
    styleLines.forEach(line => {
      const parts = line.split(',');
      if (parts.length > 8) {
        const family = parts[1].trim();
        const bold = parts[7].trim() === '-1';
        const italic = parts[8].trim() === '-1';
        addFont(family, bold, italic);
      }
    });
  }

  const eventsSection = assContent.match(/\[Events\]\s*([\s\S]*?)(?=\s*\[|$)/i);
  if (eventsSection) {
    const fnTagRegex = /\\fn([^\\}]+)/g;
    let match;
    while ((match = fnTagRegex.exec(eventsSection[1])) !== null) {
      // For \fn overrides, assume a non-bold, non-italic style unless other tags are present
      // Handles common use cases without full tag parsing
      addFont(match[1].trim(), false, false);
    }
  }

  return Array.from(requiredFonts.values());
}

const normalizeFontName = (name: string) => {
  return path.parse(name).name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

async function extractAttachmentsWithEbml(mediaPath: string): Promise<Map<string, {
  fileName: string,
  fileData: Buffer
}>> {
  const {Decoder} = await import('ts-ebml');

  console.log('[Fonts] Parsing MKV with ts-ebml to find attachments...');
  const fileBuffer = await fs.readFile(mediaPath);
  const decoder = new Decoder();
  const ebmlElements = decoder.decode(fileBuffer);

  const attachmentMap = new Map<string, { fileName: string, fileData: Buffer }>();
  const fontExtensions = ['.ttf', '.otf', '.ttc', '.woff', '.woff2'];

  let inAttachments = false;
  let inAttachedFile = false;
  let wasAttachmentsSectionFound = false;
  let currentAttachment: {
    fileName?: string;
    fileData?: Buffer;
    fileMediaType?: string;
  } = {};

  for (const el of ebmlElements) {
    if (el.name === 'Attachments') {
      wasAttachmentsSectionFound = true;
      if (el.type === 'm' && !el.isEnd) {
        inAttachments = true;
      } else if (el.type === 'm' && el.isEnd) {
        inAttachments = false;
      }
      continue;
    }

    if (inAttachments) {
      if (el.name === 'AttachedFile') {
        if (el.type === 'm' && !el.isEnd) {
          inAttachedFile = true;
          currentAttachment = {}; // Reset for the new attachment
        } else if (el.type === 'm' && el.isEnd) {
          const {fileName, fileData, fileMediaType} = currentAttachment;
          const mimeType = fileMediaType?.toLowerCase() || '';

          const isFontMime = mimeType.includes('font') || mimeType.includes('opentype');
          const isFontExtension = fileName ? fontExtensions.includes(path.extname(fileName).toLowerCase()) : false;
          const isGenericMime = mimeType.includes('application/octet-stream');

          if (fileName && fileData && (isFontMime || (isGenericMime && isFontExtension))) {
            const normalized = normalizeFontName(fileName);
            attachmentMap.set(normalized, {fileName, fileData});
            console.log(`[Fonts] Found font attachment in MKV: ${fileName} (${(fileData.length / 1024).toFixed(2)} KB)`);
          }
          inAttachedFile = false;
        }
      } else if (inAttachedFile) {
        // Accept both 's' (ASCII) and '8' (UTF-8) for string types.
        if (el.name === 'FileName' && (el.type === 's' || el.type === '8')) {
          currentAttachment.fileName = el.value;
        } else if (el.name === 'FileMediaType' && (el.type === 's' || el.type === '8')) {
          currentAttachment.fileMediaType = el.value;
        } else if (el.name === 'FileData' && el.type === 'b') {
          currentAttachment.fileData = el.value;
        }
      }
    }
  }

  if (!wasAttachmentsSectionFound) {
    console.log('[Fonts] No "Attachments" section found in the MKV file.');
  } else if (attachmentMap.size === 0) {
    console.log('[Fonts] "Attachments" section was found, but it appears to contain no valid font files.');
  } else {
    console.log(`[Fonts] Successfully extracted ${attachmentMap.size} font files.`);
  }

  return attachmentMap;
}

interface SystemFontQuery {
  family: string;
  italic: boolean;
  weight: number;
}

// On Linux, font-scanner's fontconfig calls trap (SIGTRAP) inside Electron 44's Chromium process, while the same
// addon works in a plain Node process. So look fonts up in a child process running the Electron binary as Node.
async function findSystemFonts(queries: SystemFontQuery[]): Promise<Array<{ path: string } | null>> {
  if (queries.length === 0) {
    return [];
  }

  if (process.platform !== 'linux') {
    const fontScanner = (await import('font-scanner')).default;
    const results: Array<{ path: string } | null> = [];
    for (const query of queries) {
      try {
        results.push(await fontScanner.findFont(query));
      } catch {
        results.push(null);
      }
    }
    return results;
  }

  let modulePath = path.dirname(require.resolve('font-scanner/package.json'));
  const unpackedPath = modulePath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (unpackedPath !== modulePath && existsSync(unpackedPath)) {
    modulePath = unpackedPath;
  }

  const script = `
    const scanner = require(process.argv[1]);
    (async () => {
      const out = [];
      for (const query of JSON.parse(process.argv[2])) {
        try {
          const font = await scanner.findFont(query);
          out.push(font ? {path: font.path} : null);
        } catch {
          out.push(null);
        }
      }
      process.stdout.write(JSON.stringify(out));
    })();`;

  return new Promise(resolve => {
    execFile(process.execPath, ['-e', script, modulePath, JSON.stringify(queries)], {
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        console.warn('[Fonts] System font lookup failed:', error.message);
        resolve(queries.map(() => null));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(queries.map(() => null));
      }
    });
  });
}

async function loadFontData(
  requiredFonts: RequiredFont[],
  mediaPath?: string,
  assFilePath?: string
): Promise<FontData[]> {
  const Levenshtein = (await import('fast-levenshtein')).default;
  const fontkit = (await import('fontkit')).default;

  console.log(`[Fonts] Starting search for ${requiredFonts.length} required font styles.`);
  const foundFonts = new Map<string, string>();
  const availableFonts: AvailableFont[] = [];
  const fontExtensions = ['.ttf', '.otf', '.ttc', '.woff', '.woff2'];

  const convertBufferToDataUri = (buffer: Buffer, extension: string): string | null => {
    let mimeType = '';
    const ext = extension.toLowerCase();
    if (['.ttf', '.ttf-t', '.t', '.ttc'].includes(ext)) mimeType = 'font/truetype';
    else if (['.otf'].includes(ext)) mimeType = 'font/opentype';
    else if (['.woff'].includes(ext)) mimeType = 'font/woff';
    else if (['.woff2'].includes(ext)) mimeType = 'font/woff2';
    else return null;
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  };

  const addFontToDatabase = (fontBuffer: Buffer, fileName: string, source: 'mkv' | 'local' | 'system') => {
    try {
      const createdFont = fontkit.create(fontBuffer);
      const fontsToProcess: fontkit.Font[] = 'fonts' in createdFont ? createdFont.fonts : [createdFont];
      for (const font of fontsToProcess) {
        const dataUri = convertBufferToDataUri(fontBuffer, path.extname(fileName));
        if (dataUri) {
          availableFonts.push({
            family: font.familyName,
            style: font.subfamilyName,
            isBold: font['OS/2'].fsSelection.bold,
            isItalic: font['OS/2'].fsSelection.italic,
            dataUri: dataUri,
            source: source,
          });
        }
      }
    } catch (e) {
      console.warn(`[Fonts] Failed to parse font file "${fileName}" from ${source}:`, e);
    }
  };

  // Gather candidates from all sources

  // From MKV attachments
  if (mediaPath && path.extname(mediaPath).toLowerCase() === '.mkv') {
    const attachmentMap = await extractAttachmentsWithEbml(mediaPath);
    for (const attachment of Array.from(attachmentMap.values())) {
      addFontToDatabase(attachment.fileData, attachment.fileName, 'mkv');
    }
  }

  // From local files (if external .ass)
  if (assFilePath) {
    const subDir = path.dirname(assFilePath);
    try {
      const files = await fs.readdir(subDir);
      for (const file of files) {
        if (fontExtensions.includes(path.extname(file).toLowerCase())) {
          const fontPath = path.join(subDir, file);
          const fontBuffer = await fs.readFile(fontPath);
          addFontToDatabase(fontBuffer, file, 'local');
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  // From system fonts (only search for needed fonts)
  console.log(`[Fonts] Pre-caching potential system font matches...`);
  const systemFonts = await findSystemFonts(requiredFonts.map(req => ({family: req.family, italic: req.italic, weight: req.bold ? 700 : 400})));
  for (const font of systemFonts) {
    if (!font) {
      continue;
    }
    try {
      const fontBuffer = await fs.readFile(font.path);
      addFontToDatabase(fontBuffer, path.basename(font.path), 'system');
    } catch (e) {
      /* Not readable, that's fine */
    }
  }

  // Score and decide for each requirement
  const requirementsMet = new Set<RequiredFont>();
  for (const req of requiredFonts) {
    let bestMatch: { font: AvailableFont | null; score: number } = {font: null, score: Infinity};

    for (const available of availableFonts) {
      const familyDistance = Levenshtein.get(req.family, available.family);

      // Give a large penalty if the font is a known bad fuzzy match (e.g., Arial for Kozuka)
      const isUnrelated = familyDistance > (req.family.length / 2);
      const unrelatedPenalty = isUnrelated ? 100 : 0;

      let stylePenalty = 0;
      if (req.bold !== available.isBold) stylePenalty += 2;
      if (req.italic !== available.isItalic) stylePenalty += 2;

      // Prioritize sources: MKV/Local > System
      const sourcePenalty = available.source === 'system' ? 1 : 0;

      const totalScore = familyDistance + stylePenalty + sourcePenalty + unrelatedPenalty;

      if (totalScore < bestMatch.score) {
        bestMatch = {font: available, score: totalScore};
      }
    }

    // A reasonable score means it's a good match.
    if (bestMatch.font && bestMatch.score < 10) {
      const matchType = bestMatch.font.family === req.family ? "Found" : `Fuzzy matched "${req.family}" to`;
      console.log(`[Fonts] ${matchType} "${bestMatch.font.family}" (Style: ${bestMatch.font.style}) from ${bestMatch.font.source}. Score: ${bestMatch.score}`);
      foundFonts.set(req.family, bestMatch.font.dataUri);
      requirementsMet.add(req);
    }
  }

  // Final fallback
  const remainingForFallback = requiredFonts.filter(r => !foundFonts.has(r.family));
  if (remainingForFallback.length > 0) {
    let notoFallbackUri: string | null = null;
    try {
      const notoPath = path.join(__dirname, 'dist', 'yall-mp', 'browser', 'media', 'noto-sans-latin-wght-normal.woff2');
      const fontBuffer = await fs.readFile(notoPath);
      notoFallbackUri = `data:font/woff2;base64,${fontBuffer.toString('base64')}`;
      console.log('[Fonts] Successfully loaded bundled Noto Sans Variable as a fallback option.');
    } catch (e) {
      console.warn('[Fonts] Could not load bundled Noto Sans Variable for fallback, will proceed to system fonts.', e);
    }

    if (notoFallbackUri) {
      for (const req of remainingForFallback) {
        console.warn(`[Fonts] Could not find a good match for "${req.family}". Defaulting to bundled Noto Sans.`);
        foundFonts.set(req.family, notoFallbackUri);
      }
    } else {
      const arial = availableFonts.find(f => f.family === 'Arial' && !f.isBold && !f.isItalic);
      if (arial) {
        for (const req of remainingForFallback) {
          console.warn(`[Fonts] Could not find a good match for "${req.family}". Defaulting to Arial.`);
          foundFonts.set(req.family, arial.dataUri);
        }
      }
    }
  }

  const fontData: FontData[] = [];
  for (const [fontFamily, dataUri] of foundFonts.entries()) {
    fontData.push({fontFamily, dataUri});
  }

  const finalNotFound = requiredFonts.filter(req => !foundFonts.has(req.family));
  if (finalNotFound.length > 0) {
    console.error(`[Fonts] CRITICAL: Could not find any font source for: ${finalNotFound.map(f => f.family).join(', ')}`);
  }

  console.log(`[Fonts] Search finished. Required: ${requiredFonts.length}. Found: ${fontData.length}.`);
  return fontData;
}

function getFullTextFromSubtitles(subtitles: SubtitleData[]): string {
  return subtitles.map(sub => {
    if (sub.type === 'srt') {
      return sub.text;
    } else { // ass
      return sub.parts.map(p => p.text).join('\n');
    }
  }).join('\n');
}

async function detectLanguage(text: string): Promise<SupportedLanguage> {
  const {francAll} = await import('franc-all');

  // Get all results (franc returns [ ['eng', 1.0], ['sco', 0.98], ... ])
  const langResults = francAll(text, {minLength: 3});

  if (langResults.length === 0) {
    return 'other';
  }

  // Check the top 3 candidates against languages supported by Yomitan
  const checkDepth = Math.min(langResults.length, 3);

  for (let i = 0; i < checkDepth; i++) {
    const code3 = langResults[i][0];
    const mappedCode = LEGACY_TO_YOMITAN_ISO_MAP[code3];

    if (mappedCode) {
      console.log(`[Language Detection] matched candidate #${i + 1}: ${code3} -> ${mappedCode}`);
      return mappedCode;
    }
  }

  // If no candidates in top 3 match a supported language, return 'other'
  console.log(`[Language Detection] No supported language found in top ${checkDepth}. Top candidate was: ${langResults[0][0]}`);
  return 'other';
}

async function generateAudioPeaks(projectId: string, mediaPath: string, audioTrackIndex?: number): Promise<number[][] | null> {
  await ensureFFmpegPaths();

  const platform = process.platform;

  // Check user path override first
  const fsLib = require('fs');
  let audiowaveformPath: string | undefined = customExecutables.audiowaveform && fsLib.existsSync(customExecutables.audiowaveform)
    ? customExecutables.audiowaveform
    : undefined;

  if (!audiowaveformPath) {
    if (platform === 'win32') {
      // On Windows, use the downloaded binary
      const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
      audiowaveformPath = path.join(basePath, 'electron-resources', 'windows', 'audiowaveform.exe');
    } else {
      // On macOS/Linux, try to resolve absolute path
      try {
        audiowaveformPath = require('child_process').execSync('which audiowaveform').toString().trim();
      } catch (e) {
        // Fallback: Check common install locations manually
        const commonPaths = [
          '/usr/bin/audiowaveform',
          '/usr/local/bin/audiowaveform',
          '/opt/homebrew/bin/audiowaveform'
        ];
        const fs = require('fs');
        audiowaveformPath = commonPaths.find(p => fs.existsSync(p));
      }
    }
  }

  // Last resort - the global PATH
  if (!audiowaveformPath) {
    audiowaveformPath = 'audiowaveform';
  }

  for (const exePath of [audiowaveformPath, ffmpegPath]) {
    try {
      await fs.access(exePath);
    } catch (error) {
      console.error(`[Peaks] Executable not found at ${exePath}`);
      return null;
    }
  }

  console.log(`[Peaks] Generating waveform peaks for project ${projectId} using a WAV pipe (audio track index: ${audioTrackIndex ?? 'Default'}).`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = ['-i', mediaPath];

    if (audioTrackIndex != null) {
      ffmpegArgs.push('-map', `0:${audioTrackIndex}`);
    }

    // -f wav: Output format is WAV.
    // -ar 16000: Downsample to 16kHz. Still very fast, but slightly better quality than 8kHz.
    ffmpegArgs.push('-vn', '-f', 'wav', '-ac', '1', '-ar', '16000', '-');

    // When reading from a pipe (stdin), audiowaveform needs to be explicitly told the input format
    const audiowaveformArgs = [
      '--input-format', 'wav',
      '-i', '-',
      '--output-format', 'json',
      '--pixels-per-second', '20',
      '--bits', '8'
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
    const audiowaveformProcess = spawn(audiowaveformPath, audiowaveformArgs);

    // Pipe the output of ffmpeg to the input of audiowaveform
    ffmpegProcess.stdout.pipe(audiowaveformProcess.stdin);

    let jsonData = '';
    const ffmpegError: string[] = [];
    const audiowaveformError: string[] = [];

    audiowaveformProcess.stdout.on('data', (data) => {
      jsonData += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => ffmpegError.push(data.toString()));
    audiowaveformProcess.stderr.on('data', (data) => audiowaveformError.push(data.toString()));

    const killProcesses = () => {
      if (!ffmpegProcess.killed) ffmpegProcess.kill();
      if (!audiowaveformProcess.killed) audiowaveformProcess.kill();
    };

    ffmpegProcess.on('error', (err) => {
      killProcesses();
      reject(err);
    });

    audiowaveformProcess.on('error', (err) => {
      killProcesses();
      reject(err);
    });

    audiowaveformProcess.on('close', async (code) => {
      killProcesses();

      if (code === 0) {
        if (!jsonData) {
          const combinedError = `FFMPEG Stderr:\n${ffmpegError.join('')}\n\nAUDIOWAVEFORM Stderr:\n${audiowaveformError.join('')}`;
          console.error(`[Peaks] Pipeline failed: audiowaveform received no data from ffmpeg.`);
          console.error(combinedError);
          reject(new Error('FFmpeg failed to provide audio data.'));
          return;
        }
        try {
          const waveformData = JSON.parse(jsonData);
          const rawPeaks = waveformData.data;
          const scale = waveformData.bits === 8 ? 128 : 32768; // Output is 8-bit, so scale will be 128
          const normalizedPeaks: number[] = rawPeaks.map((p: number) => p / scale);

          const peaks = [normalizedPeaks];
          console.log(`[Peaks] Successfully generated and normalized ${normalizedPeaks.length} data points.`);

          const peaksPath = path.join(PROJECTS_DIR, `${projectId}.peaks.json`);
          await fs.writeFile(peaksPath, JSON.stringify(peaks), 'utf-8');

          resolve(peaks);
        } catch (e) {
          console.error('[Peaks] Failed to parse JSON from audiowaveform output.', e);
          reject(new Error('Failed to parse waveform data.'));
        }
      } else {
        const combinedError = `FFMPEG Stderr:\n${ffmpegError.join('')}\n\nAUDIOWAVEFORM Stderr:\n${audiowaveformError.join('')}`;
        console.error(`[Peaks] Pipeline failed. audiowaveform process exited with code ${code}.`);
        console.error(`[Peaks] Combined Stderr:\n${combinedError}`);
        const relevantError = (audiowaveformError.join('').trim() || ffmpegError.join('').trim() || `Waveform generation failed.`).split('\n').pop();
        reject(new Error(relevantError));
      }
    });
  });
}

function getFilesFromArgv(argv: string[]): string[] {
  return argv.filter(arg => {
    try {
      if (arg.startsWith('--') || arg.toLowerCase().endsWith('electron.exe') || arg.includes('electron-main.js')) {
        return false;
      }
      const stat = statSync(arg);
      if (stat.isFile()) {
        const ext = path.extname(arg).toLowerCase().replace('.', '');
        return SUPPORTED_MEDIA_TYPES.includes(ext) || SUPPORTED_SUBTITLE_TYPES.includes(ext);
      }
      return false;
    } catch (e) {
      return false;
    }
  });
}

async function checkSystemDependencies() {
  // Only check on non-Windows platforms because Windows bundles its own binaries
  if (process.platform === 'win32') {
    return;
  }

  const spawnCheck = (name: string) => new Promise<void>((resolve, reject) => {
    // Try to run with "--version" flag to see if dependency exists
    const check = spawn(name, ['--version']);
    check.on('error', () => reject()); // Error means command not found
    check.on('close', (code) => code === 0 ? resolve() : reject());
  });

  const dependencies: { name: string, installCmd: string, check: () => Promise<void> }[] = [
    {
      name: 'audiowaveform',
      installCmd: process.platform === 'darwin' ? 'brew tap bbc/audiowaveform && brew install audiowaveform' : 'See https://github.com/bbc/audiowaveform',
      check: () => spawnCheck('audiowaveform')
    }
  ];

  // Playback loads libmpv from the system: in-process on macOS, through the yall-mpv-host executable on Linux.
  dependencies.unshift({
    name: 'libmpv',
    installCmd: process.platform === 'darwin'
      ? 'brew install mpv'
      : 'sudo apt install libmpv2 (Debian/Ubuntu) or sudo dnf install mpv-libs (Fedora, RPM Fusion)',
    check: async () => {
      ensureLibmpv(app.getAppPath(), customExecutables.libmpv, process.platform);
    }
  });

  const missing: string[] = [];

  for (const dep of dependencies) {
    try {
      await dep.check();
    } catch (e) {
      missing.push(`${dep.name}\n   (Install: ${dep.installCmd})`);
    }
  }

  if (missing.length > 0) {
    const response = await dialog.showMessageBox({
      type: 'error',
      title: 'Missing Dependencies',
      message: 'Y\'ALL MP requires external tools to run on this operating system.',
      detail: `Please install the following:\n\n${missing.join('\n\n')}`,
      buttons: ['Quit', 'I installed them, try again', 'Open Build Instructions'],
      defaultId: 0,
      cancelId: 0
    });

    if (response.response === 0) { // Quit
      app.quit();
    } else if (response.response === 1) { // Try again
      // Recursively check again
      checkSystemDependencies();
    } else if (response.response === 2) { // Open instructions
      shell.openExternal('https://github.com/kgurniak91/yall-mp#readme');
      app.quit();
    }
  }
}

function notifyLookupWindowState(isVisible: boolean) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lookup:window-state-changed', isVisible);
  }
}
