// Main-process wrapper around the yall-libmpv native addon. It must not import `electron`, so it can be
// unit tested and run in plain Node (the integration tests in test/native do exactly that).
import {EventEmitter} from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {createHostAddon, FdPassAddon, fdpassCandidates, hostCandidates} from './libmpv-host';

export type LibmpvErrorCode = 'ADDON_NOT_FOUND' | 'LIB_NOT_FOUND' | 'LIB_TOO_OLD' | 'INIT_FAILED';

export interface TriedPath {
  path: string;
  error: string;
}

/** A user-readable failure to bring up libmpv. Never a crash: every missing piece ends up here. */
export class LibmpvError extends Error {
  constructor(readonly code: LibmpvErrorCode, message: string, readonly tried: TriedPath[] = []) {
    super(message);
    this.name = 'LibmpvError';
  }
}

export type LibmpvEndReason = 'eof' | 'stop' | 'quit' | 'error' | 'redirect';

export type LibmpvEvent =
  | { event: 'property-change'; id: number; name: string; data: unknown }
  | { event: 'end-file'; reason: LibmpvEndReason; error?: { code: string; message: string } }
  | { event: 'start-file' | 'file-loaded' | 'seek' | 'playback-restart' | 'shutdown' }
  | { event: 'log-message'; prefix: string; level: string; text: string }
  | { event: 'client-message'; args: string[] };

export type LibmpvPropertyValue = boolean | number | string;

export interface NativeMpvCore {
  setOption(name: string, value: string): void;
  /** The in-process addon initializes synchronously, the Linux host asynchronously. */
  initialize(): void | Promise<void>;
  onEvent(listener: (event: LibmpvEvent) => void): void;
  command(args: string[]): Promise<unknown>;
  getProperty(name: string): Promise<unknown>;
  setProperty(name: string, value: LibmpvPropertyValue): Promise<void>;
  observeProperty(name: string): number;
  unobserveProperty(id: number): void;
  requestLogMessages(level: string): void;
  destroy(): Promise<void>;
  /** The in-process addon answers at once, the Linux host with the host's own answer. */
  attachRenderer(options: AttachRendererOptions, onFrame: (frame: RenderFrame) => void): AttachResult | Promise<AttachResult>;
  resize(width: number, height: number): void;
  releaseSlot(attachId: number, slotId: number, serial: number): void;
  detachRenderer(): void;
  stats(): RenderStats | null;
}

// ---- render API ----

export type RenderBackendName = 'd3d11-shared' | 'iosurface-shared' | 'dmabuf-shared' | 'readback';

/** The backends that hand out GPU surfaces (`RenderFrame.handle`) instead of pixels. */
export type SharedBackendName = Exclude<RenderBackendName, 'readback'>;

/** 'default' = the system default adapter, 'warp' = the software rasteriser, or a vendor/device to match. */
export type AdapterOption = 'default' | 'warp' | { vendorId: number; deviceId: number };

export interface AttachRendererOptions {
  backend: RenderBackendName;
  width: number;
  height: number;
  /** Shared backends' pool size, 1..8. Default 4. */
  slots?: number;
  /** In-flight slots older than this are abandoned instead of reused. Default 3000. */
  slotTimeoutMs?: number;
  /** Readback only. Default: 'd3d11' where the API allows it (Windows, client API 2.6+), else 'sw'. */
  impl?: 'd3d11' | 'sw';
  adapter?: AdapterOption;
}

export interface AdapterDescription {
  name: string;
  vendorId: number;
  deviceId: number;
  luid: string;
  software: boolean;
  matched: boolean;
  /** default | warp | match | default-no-match | warp-fallback | sw */
  selection: string;
}

export interface AttachResult {
  attachId: number;
  backend: RenderBackendName;
  impl: 'd3d11' | 'gl' | 'sw';
  gpuWaitImpl: 'fence' | 'enqueue-event' | 'query-poll' | 'finish' | 'none';
  adapter: AdapterDescription;
}

/**
 * One rendered frame. Shared backends carry `handle` (8-byte value: an NT handle for d3d11-shared, an IOSurfaceRef for
 * iosurface-shared) or `dmabuf` (dmabuf-shared), readback ones `pixels` (BGRA).
 */
export interface RenderFrame {
  attachId: number;
  slotId: number;
  serial: number;
  generation: number;
  width: number;
  height: number;
  handle?: Buffer;
  /** The slot's dma-buf plane. The descriptor stays owned by the host client: import it (Electron dups it), do not close it. */
  dmabuf?: DmabufPlane;
  /** GL shared backends, first frames only: BGRA of five points the host read from the rendered buffer (20 numbers). */
  probe?: number[];
  pixels?: Buffer;
}

/** One dma-buf plane of a shared slot. */
export interface DmabufPlane {
  fd: number;
  stride: number;
  offset: number;
  size: number;
  /** DRM format modifier as a decimal string (what Electron's `nativePixmap.modifier` expects). */
  modifier: string;
}

export interface Percentiles {
  p50: number;
  p95: number;
  max: number;
}

export interface RenderStats {
  attachId: number;
  backend: RenderBackendName;
  impl: 'd3d11' | 'gl' | 'sw';
  gpuWaitImpl: string;
  adapter: AdapterDescription;
  width: number;
  height: number;
  generation: number;
  poolSize: number;
  inFlight: number;
  rendered: number;
  exhausted: number;
  released: number;
  lateReleases: number;
  reclaimed: number;
  gpuWaitTimeouts: number;
  readbackDropped: number;
  postFailures: number;
  renderMs: Percentiles;
  gpuWaitMs: Percentiles;
  releaseMs: Percentiles;
  copyMs: Percentiles;
  renderCpuMs: number;
  waitCpuMs: number;
  threadCpuMs: number;
  threadWallMs: number;
  /** Detached attaches that are still draining their in-flight slots. */
  draining: number;
  /** GL backends: glGetError() results other than GL_NO_ERROR. */
  glErrors?: number;
  /** GL backends: GL version/renderer and the first GL errors, for logs. */
  note?: string;
}

export interface LiveCounts {
  cores: number;
  eventThreads: number;
  renderers: number;
  renderThreads: number;
  slots: number;
}

export interface NativeAddon {
  /** 'host' when libmpv runs in the `yall-mpv-host` child process (Linux), absent for the in-process addon. */
  kind?: 'host';
  loadLibrary(libraryPath: string): { path: string; apiVersion: [number, number] };
  apiVersion(): [number, number] | null;
  liveCounts(): LiveCounts;
  /** macOS only, test support: the BGRA pixel at (x, y) of a live IOSurface frame handle, null when out of range. */
  readSurfacePixel?(handle: Buffer, x: number, y: number): { r: number; g: number; b: number; a: number } | null;
  MpvCore: new () => NativeMpvCore;
}

export type ApiVersion = [number, number];

/** Oldest client API we accept. D3D11 rendering needs 2.6 on top of this, see `Libmpv.supportsD3D11`. */
export const MIN_API_VERSION: ApiVersion = [2, 0];
export const D3D11_API_VERSION: ApiVersion = [2, 6];

export const compareApiVersion = (a: ApiVersion, b: ApiVersion): number => a[0] - b[0] || a[1] - b[1];

const formatVersion = (v: ApiVersion): string => `${v[0]}.${v[1]}`;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

// ---- addon discovery ----

/** Inside a packaged app the .node file lives next to app.asar, not inside it. */
export const toUnpackedPath = (filePath: string): string => filePath.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');

export interface AddonCandidateOptions {
  env?: NodeJS.ProcessEnv;
  explicitPath?: string;
  appRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export const addonCandidates = (options: AddonCandidateOptions): string[] => {
  const {env = process.env, explicitPath, appRoot, platform = process.platform, arch = process.arch} = options;
  const addonDir = path.join(appRoot, 'native', 'yall-libmpv');
  const candidates = [
    env['YALL_LIBMPV_ADDON'],
    explicitPath,
    path.join(addonDir, 'build', 'Release', 'yall_libmpv.node'),
    path.join(addonDir, 'prebuilds', `${platform}-${arch}`, 'yall_libmpv.node')
  ];
  return candidates.filter((c): c is string => !!c).map(toUnpackedPath);
};

export interface LoadAddonOptions {
  addonPath?: string;
  /** Directory the addon is looked up from; the root files compile in place, so this is `__dirname`. */
  appRoot?: string;
  /** Replaceable for tests. */
  dlopen?: (module: { exports: unknown }, file: string) => void;
  /** Linux talks to the `yall-mpv-host` executable instead of loading an addon. Default: `process.platform`. */
  platform?: NodeJS.Platform;
  hostPath?: string;
  /** The yall_fdpass addon of the dma-buf backend: a path, or false to run without it. */
  fdpassPath?: string | false;
  /** Where a packaged app keeps the host. Default: `process.resourcesPath`. */
  resourcesPath?: string;
}

let cachedAddon: NativeAddon | null = null;

export const loadLibmpvAddon = (options: LoadAddonOptions = {}): NativeAddon => {
  if (cachedAddon && !options.dlopen) {
    return cachedAddon;
  }
  if ((options.platform ?? process.platform) === 'linux' && !options.dlopen) {
    return cachedAddon = loadHostAddon(options);
  }
  const dlopen = options.dlopen ?? ((module, file) => process.dlopen(module as NodeJS.Module, file));
  const candidates = addonCandidates({explicitPath: options.addonPath, appRoot: options.appRoot ?? __dirname});

  const tried: TriedPath[] = [];
  for (const candidate of candidates) {
    if (!options.dlopen && !fs.existsSync(candidate)) {
      tried.push({path: candidate, error: 'file does not exist'});
      continue;
    }
    try {
      const module = {exports: {} as unknown};
      dlopen(module, candidate);
      const addon = module.exports as NativeAddon;
      if (!options.dlopen) {
        cachedAddon = addon;
      }
      return addon;
    } catch (error) {
      tried.push({path: candidate, error: errorMessage(error)});
    }
  }

  throw new LibmpvError('ADDON_NOT_FOUND',
    `The libmpv native addon could not be loaded. Run "npm run native:build". Tried:\n${formatTried(tried)}`, tried);
};

/** Linux: libmpv cannot live in the Electron process, so it runs in the host executable. */
const loadHostAddon = (options: LoadAddonOptions): NativeAddon => {
  const candidates = hostCandidates({
    explicitPath: options.hostPath,
    appRoot: options.appRoot ?? __dirname,
    resourcesPath: options.resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath
  }).map(toUnpackedPath);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    const tried = candidates.map((candidate): TriedPath => ({path: candidate, error: 'file does not exist'}));
    throw new LibmpvError('ADDON_NOT_FOUND',
      `The libmpv host (yall-mpv-host) could not be found. Run "npm run native:build". Tried:
${formatTried(tried)}`, tried);
  }
  return createHostAddon({hostPath: found, fdpass: options.fdpassPath === false ? null : loadFdPass(options)});
};

/**
 * The descriptor receiver is optional: when it is missing or does not load, only the dma-buf backend is lost.
 * It links neither libmpv nor ffmpeg, so unlike libmpv it can live in this process.
 */
const loadFdPass = (options: LoadAddonOptions): FdPassAddon | null => {
  const candidates = fdpassCandidates({appRoot: options.appRoot ?? __dirname});
  if (options.fdpassPath) {
    candidates.unshift(options.fdpassPath);
  }
  for (const candidate of candidates.map(toUnpackedPath)) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const module = {exports: {} as unknown};
      process.dlopen(module as NodeJS.Module, candidate);
      return module.exports as FdPassAddon;
    } catch {
      // try the next candidate
    }
  }
  return null;
};

// ---- libmpv discovery ----

export interface LibmpvCandidateOptions {
  platform?: NodeJS.Platform;
  /** Directory that contains `electron-resources` (the app root in dev, `process.resourcesPath` when packaged). */
  basePath: string;
  customPath?: string;
}

export const libmpvCandidates = (options: LibmpvCandidateOptions): string[] => {
  const {platform = process.platform, basePath, customPath} = options;
  let defaults: string[];
  switch (platform) {
    case 'win32':
      defaults = [path.join(basePath, 'electron-resources', 'windows', 'libmpv-2.dll')];
      break;
    case 'darwin':
      defaults = ['/opt/homebrew/lib/libmpv.2.dylib', '/usr/local/lib/libmpv.2.dylib', 'libmpv.2.dylib', 'libmpv.dylib'];
      break;
    default:
      defaults = ['libmpv.so.2', 'libmpv.so'];
  }
  return [...(customPath ? [customPath] : []), ...defaults];
};

const formatTried = (tried: TriedPath[]): string => tried.map(t => `  ${t.path}: ${t.error}`).join('\n');

export interface LoadedLibmpv {
  path: string;
  apiVersion: ApiVersion;
}

/** Loads the first candidate that works. Throws `LibmpvError` (LIB_NOT_FOUND / LIB_TOO_OLD) otherwise. */
export const loadLibmpv = (addon: NativeAddon, candidates: string[]): LoadedLibmpv => {
  const tried: TriedPath[] = [];
  for (const candidate of candidates) {
    let loaded: { path: string; apiVersion: ApiVersion };
    try {
      loaded = addon.loadLibrary(candidate);
    } catch (error) {
      if ((error as { code?: string }).code === 'LIB_ALREADY_LOADED') {
        throw new LibmpvError('INIT_FAILED', errorMessage(error), tried);
      }
      tried.push({path: candidate, error: errorMessage(error)});
      continue;
    }
    if (compareApiVersion(loaded.apiVersion, MIN_API_VERSION) < 0) {
      throw new LibmpvError('LIB_TOO_OLD',
        `libmpv at ${loaded.path} has client API ${formatVersion(loaded.apiVersion)}; Y'ALL MP needs ${formatVersion(MIN_API_VERSION)}+.`, tried);
    }
    return loaded;
  }
  throw new LibmpvError('LIB_NOT_FOUND',
    `libmpv was not found. Install it or set its path in the Advanced settings. Tried:\n${formatTried(tried)}`, tried);
};

// ---- the player ----

export interface LibmpvCreateOptions {
  options: Record<string, string>;
  apiVersion: ApiVersion;
  platform?: NodeJS.Platform;
  /** The libmpv library that was loaded, for diagnostics. */
  libraryPath?: string;
}

/** Where libmpv runs and which one it is, for the video log. */
export interface LibmpvInfo {
  kind: 'addon' | 'host';
  platform: NodeJS.Platform;
  apiVersion: ApiVersion;
  libraryPath?: string;
}

/**
 * One libmpv core. Emits `'event'` with every raw event and also the event under its own name
 * (`'property-change'`, `'end-file'`, `'seek'`, `'playback-restart'`, ...).
 */
export class Libmpv extends EventEmitter {
  private destroyed = false;

  private constructor(
    private readonly core: NativeMpvCore,
    readonly apiVersion: ApiVersion,
    private readonly platform: NodeJS.Platform,
    readonly info: LibmpvInfo) {
    super();
  }

  /** Sets the options, initializes the core and starts the event pump. Rejects with `LibmpvError('INIT_FAILED')`. */
  static async create(addon: NativeAddon, create: LibmpvCreateOptions): Promise<Libmpv> {
    let core: NativeMpvCore | undefined;
    try {
      core = new addon.MpvCore();
      for (const [name, value] of Object.entries(create.options)) {
        core.setOption(name, value);
      }
      await core.initialize();
    } catch (error) {
      void core?.destroy().catch(() => undefined);
      throw new LibmpvError('INIT_FAILED', `libmpv failed to initialize: ${errorMessage(error)}`);
    }
    const platform = create.platform ?? process.platform;
    const libmpv = new Libmpv(core, create.apiVersion, platform, {
      kind: addon.kind ?? 'addon', platform, apiVersion: create.apiVersion, libraryPath: create.libraryPath
    });
    core.onEvent((event) => {
      libmpv.emit('event', event);
      libmpv.emit(event.event, event);
    });
    return libmpv;
  }

  /** The D3D11 render API exists from client API 2.6, and only on Windows. */
  supportsD3D11(): boolean {
    return this.platform === 'win32' && compareApiVersion(this.apiVersion, D3D11_API_VERSION) >= 0;
  }

  /**
   * The GPU-surface backend that `auto` picks, or null where readback is the default. Linux has `dmabuf-shared`, but
   * only on request (`preferred: 'dmabuf-shared'`) until a working real GPU has been reported.
   */
  sharedBackendName(): SharedBackendName | null {
    if (this.supportsD3D11()) {
      return 'd3d11-shared';
    }
    // The OpenGL render API the macOS backend uses exists in every client API we accept.
    return this.platform === 'darwin' ? 'iosurface-shared' : null;
  }

  command(args: string[]): Promise<unknown> {
    return this.core.command(args);
  }

  getProperty<T = unknown>(name: string): Promise<T> {
    return this.core.getProperty(name) as Promise<T>;
  }

  setProperty(name: string, value: LibmpvPropertyValue): Promise<void> {
    return this.core.setProperty(name, value);
  }

  observeProperty(name: string): number {
    return this.core.observeProperty(name);
  }

  unobserveProperty(id: number): void {
    this.core.unobserveProperty(id);
  }

  requestLogMessages(level: string): void {
    this.core.requestLogMessages(level);
  }

  /**
   * Starts rendering into frames delivered to `onFrame` (on the main thread). Attaching again detaches the
   * previous attach first. Rejects with an Error with a `code` (LIB_TOO_OLD, RENDER_INIT_FAILED, ...).
   */
  async attachRenderer(options: AttachRendererOptions, onFrame: (frame: RenderFrame) => void): Promise<AttachResult> {
    const result = await this.core.attachRenderer(options, onFrame);
    if (result.impl === 'd3d11' && result.adapter.software) {
      // WARP rasterises mpv's default scalers on the CPU at ~55 ms per 960x540 frame (17 fps). The built-in
      // "fast" profile (bilinear scalers, no dithering) brings it to full frame rate.
      this.core.command(['apply-profile', 'fast']).catch(() => undefined);
      // Hardware decoding through a software adapter is pointless (the native side already disabled the hwdec
      // interops for the render context).
      this.core.setProperty('hwdec', 'no').catch(() => undefined);
    }
    return result;
  }

  /** Forces a redraw at the new size, also while paused. Frames of the old size can still arrive. */
  resize(width: number, height: number): void {
    this.core.resize(width, height);
  }

  /** Gives a shared slot back. Also valid for a detached attach that is still draining. Stale ids are ignored. */
  releaseSlot(attachId: number, slotId: number, serial: number): void {
    this.core.releaseSlot(attachId, slotId, serial);
  }

  /**
   * mpv drops its video output when the render context is freed, so after detaching and attaching again
   * (e.g. a fallback from shared textures to readback while a file is playing) the video has to be
   * re-created. Toggling the video track does that and keeps the playback position.
   */
  async reinitVideo(): Promise<void> {
    await this.core.setProperty('vid', 'no');
    await this.core.setProperty('vid', 'auto');
  }

  /** Non-blocking. Slots handed out earlier stay valid until released or timed out. */
  detachRenderer(): void {
    this.core.detachRenderer();
  }

  stats(): RenderStats | null {
    return this.core.stats();
  }

  /** Idempotent. Pending promises reject with code `DESTROYED`. */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    await this.core.destroy();
    this.removeAllListeners();
  }
}

// ---- readback sizing ----

export interface Size {
  width: number;
  height: number;
}

export const READBACK_CAP: Size = {width: 1280, height: 720};
export const READBACK_CAP_SOFTWARE: Size = {width: 960, height: 540};

export interface ReadbackSizeInput {
  /** Canvas backing size (CSS px x devicePixelRatio). */
  canvas: Size;
  /** Native size of the video; the canvas never needs more pixels than the video has. */
  video?: Size;
  /** Software rendering (WARP, mpv's SW renderer): use the smaller cap. */
  software: boolean;
}

const evenAtLeastTwo = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Size of the CPU readback frame: the canvas scaled down, keeping its aspect, to fit into
 * min(canvas, video native size, cap). The canvas scales the frame back up. Even dimensions, min 2x2.
 */
export const computeReadbackSize = (input: ReadbackSizeInput): Size => {
  const {canvas, video, software} = input;
  const cap = software ? READBACK_CAP_SOFTWARE : READBACK_CAP;
  const limits = [1, cap.width / canvas.width, cap.height / canvas.height];
  if (video && video.width > 0 && video.height > 0) {
    limits.push(video.width / canvas.width, video.height / canvas.height);
  }
  const scale = Math.min(...limits);
  return {width: evenAtLeastTwo(canvas.width * scale), height: evenAtLeastTwo(canvas.height * scale)};
};
