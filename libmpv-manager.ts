// Playback engine behind PlaybackManager: libmpv in-process through the native addon. It must not import
// `electron`, so it can be unit tested and run in plain Node. It keeps the surface and the 'status' payloads
// of the former mpv process wrapper, so the consumers did not have to change.
import {EventEmitter} from 'events';
import * as path from 'path';
import type {SubtitleSelection} from './src/app/model/project.types';
import type {MediaTrack} from './shared/types/media.type';
import {
  ApiVersion,
  Libmpv,
  LibmpvError,
  LibmpvEvent,
  libmpvCandidates,
  loadLibmpv,
  loadLibmpvAddon,
  NativeAddon
} from './libmpv-bridge';

const TIME_UPDATE_FPS = 10;
const LOAD_TIMEOUT_MS = 15000;

/** Properties the manager always observes; main used to observe them one by one after `start()`. */
const OBSERVED_PROPERTIES = [
  'time-pos', 'duration', 'pause', 'volume', 'mute', 'eof-reached', 'idle-active', 'user-data/auto-pause-fired'
];

export interface LibmpvManagerOptions {
  /** Directory that contains `electron-resources` and `mpv` (the app root in dev, `process.resourcesPath` when packaged). */
  basePath: string;
  customLibmpvPath?: string;
  platform?: NodeJS.Platform;
  /** mpv options that override the defaults (the integration tests use `ao: 'null'`). */
  options?: Record<string, string>;
  /** Test seam: creates the player from the final option map instead of loading the addon and the library. */
  libmpvFactory?: (options: Record<string, string>) => Libmpv | Promise<Libmpv>;
  /**
   * Gives the video a surface. It runs after the player is created and before the file is loaded (a render
   * context freed later takes mpv's video output with it) and switches `vo` to `libmpv`. The returned function
   * undoes it and runs first in `stop()`. Without it there is no video output (`vo=null`).
   */
  attachVideo?: (libmpv: Libmpv) => (() => void) | void | Promise<(() => void) | void>;
}

interface LoadedRuntime {
  addon: NativeAddon;
  path: string;
  apiVersion: ApiVersion;
}

// libmpv can be loaded once per process, so the result is shared by every manager.
let runtime: LoadedRuntime | null = null;

/** Loads the addon and libmpv once per process (custom path first, then the defaults). Throws `LibmpvError`. */
export const ensureLibmpv = (basePath: string, customPath: string | undefined, platform: NodeJS.Platform): LoadedRuntime => {
  if (runtime) {
    if (customPath && path.resolve(customPath) !== path.resolve(runtime.path)) {
      console.warn(`[LibmpvManager] libmpv is already loaded from ${runtime.path}; restart to use ${customPath}.`);
    }
    return runtime;
  }
  const addon = loadLibmpvAddon();
  if (customPath) {
    try {
      const loaded = loadLibmpv(addon, libmpvCandidates({platform, basePath, customPath}).slice(0, 1));
      return runtime = {addon, ...loaded};
    } catch (error) {
      if (error instanceof LibmpvError && error.code === 'LIB_TOO_OLD') {
        throw error;
      }
      console.warn(`[LibmpvManager] Custom libmpv path invalid: ${customPath}. Falling back to default.`);
    }
  }
  const loaded = loadLibmpv(addon, libmpvCandidates({platform, basePath}));
  return runtime = {addon, ...loaded};
};

type MpvProperty = Extract<LibmpvEvent, { event: 'property-change' }>;

export class LibmpvManager extends EventEmitter {
  public mediaPath: string = '';
  private libmpv: Libmpv | null = null;
  private stopping = false;
  private paused = true;
  private timePos: number | null = null;
  private lastIdle: boolean | undefined;
  private detachVideo: (() => void) | null = null;
  private pendingSeeks = 0;
  /** An absolute seek that mpv refused (for example while the video output was being re-created), re-issued after the next file-loaded. */
  private failedSeek: string[] | null = null;
  private timeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly observed = new Set<string>();

  constructor(private readonly config: LibmpvManagerOptions) {
    super();
  }

  public async start(
    mediaPath: string,
    audioTrackIndex: number | null,
    subtitleSelection: SubtitleSelection,
    allSubtitleTracks: MediaTrack[],
    useMpvSubtitles: boolean,
    subtitlesVisible: boolean,
    hardwareAcceleration: boolean,
    volume: number,
    isMuted: boolean
  ): Promise<void> {
    this.mediaPath = mediaPath;
    const platform = this.config.platform ?? process.platform;

    const options: Record<string, string> = {
      // Without a surface `null` still decodes, so seeking behaves.
      vo: this.config.attachVideo ? 'libmpv' : 'null',
      hwdec: hardwareAcceleration ? 'auto' : 'no',
      'load-scripts': 'yes',
      scripts: path.join(this.config.basePath, 'mpv', 'yall_auto_pause.lua'),
      osc: 'no',
      'osd-bar': 'no',
      'input-default-bindings': 'no',
      'keep-open': 'always',
      idle: 'yes',
      pause: 'yes',
      'sub-visibility': 'no',
      'hr-seek': 'default',
      'hr-seek-framedrop': 'yes',
      cache: 'no',
      'vd-lavc-threads': '0',          // Use all available CPU cores for decoding
      'demuxer-max-bytes': '150MiB',   // Increase demuxer cache
      'demuxer-readahead-secs': '20',  // Prefetch more data
      framedrop: 'vo',                 // Drop frames visually if rendering is too slow to maintain sync
      'vd-lavc-fast': 'yes',           // Allow optimizations that might slightly violate spec but improve speed
      'sws-allow-zimg': 'no',          // Disable zimg (can be slow/buggy on old systems), fallback to swscale
      volume: String(volume),
      mute: isMuted ? 'yes' : 'no'
    };

    if (audioTrackIndex !== null) {
      options['aid'] = String(audioTrackIndex);
    }

    let mpvRelativeSubtitleIndex: number | undefined = undefined;
    if (subtitleSelection.type === 'embedded') {
      // Find the 0-based position of the selected track within the list of ONLY subtitle tracks:
      const relativeIndex = allSubtitleTracks.findIndex(track => track.index === subtitleSelection.trackIndex);
      if (relativeIndex !== -1) {
        // MPV's relative track IDs are 1-based:
        mpvRelativeSubtitleIndex = (relativeIndex + 1);
        options['sid'] = String(mpvRelativeSubtitleIndex);
        console.log(`[LibmpvManager] Mapped ffprobe absolute index ${subtitleSelection.trackIndex} to mpv relative index ${mpvRelativeSubtitleIndex}`);
      } else {
        console.warn(`[LibmpvManager] Could not find selected subtitle track index ${subtitleSelection.trackIndex} in the provided list.`);
      }
    }

    Object.assign(options, this.config.options);

    try {
      await this.stop();
      this.stopping = false;
      this.resetState();
      const libmpv = await this.createPlayer(options, platform);
      this.libmpv = libmpv;
      this.detachVideo = (await this.config.attachVideo?.(libmpv)) ?? null;
      libmpv.on('event', (event: LibmpvEvent) => this.handleEvent(event));
      libmpv.requestLogMessages('warn');
      for (const property of OBSERVED_PROPERTIES) {
        this.observeProperty(property);
      }
      this.timeTimer = setInterval(() => this.emitTimePos(), 1000 / TIME_UPDATE_FPS);

      // The waiter is armed before loadfile: file-loaded can arrive before the command resolves.
      const loaded = this.waitForLoad(libmpv);
      loaded.catch(() => undefined);
      await libmpv.command(['loadfile', mediaPath, 'replace']);
      await loaded;
      console.log(`[LibmpvManager] Loaded media: ${mediaPath}`);

      if (subtitleSelection.type === 'external') {
        await libmpv.command(['sub-add', subtitleSelection.filePath, 'select']);
        console.log(`[LibmpvManager] Added external subtitles: ${subtitleSelection.filePath}`);
      } else if (subtitleSelection.type === 'embedded' && mpvRelativeSubtitleIndex != null) {
        await libmpv.setProperty('sid', mpvRelativeSubtitleIndex);
        console.log(`[LibmpvManager] Selected embedded subtitle track: ${mpvRelativeSubtitleIndex}`);
      }

      await libmpv.setProperty('sub-visibility', useMpvSubtitles && subtitlesVisible);

      this.emit('ready');
    } catch (error) {
      console.error('[LibmpvManager] Failed to start libmpv or load file:', error);
      await this.stop();
      throw error;
    }
  }

  private async createPlayer(options: Record<string, string>, platform: NodeJS.Platform): Promise<Libmpv> {
    if (this.config.libmpvFactory) {
      return this.config.libmpvFactory(options);
    }
    const {addon, apiVersion, path: libraryPath} = ensureLibmpv(this.config.basePath, this.config.customLibmpvPath, platform);
    return await Libmpv.create(addon, {options, apiVersion, platform, libraryPath});
  }

  private resetState(): void {
    this.paused = true;
    this.timePos = null;
    this.lastIdle = undefined;
    this.pendingSeeks = 0;
    this.failedSeek = null;
    this.observed.clear();
  }

  /** Resolves on `file-loaded`, rejects on an `end-file` with an error or after the timeout. */
  private waitForLoad(libmpv: Libmpv): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Timed out loading ${this.mediaPath}`)), LOAD_TIMEOUT_MS);
      const onEvent = (event: LibmpvEvent) => {
        if (event.event === 'file-loaded') {
          finish();
        } else if (event.event === 'end-file' && event.reason === 'error') {
          finish(new Error(event.error?.message ?? `Failed to load ${this.mediaPath}`));
        } else if (event.event === 'shutdown') {
          finish(new Error('libmpv shut down while loading the file'));
        }
      };
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        libmpv.off('event', onEvent);
        error ? reject(error) : resolve();
      };
      libmpv.on('event', onEvent);
    });
  }

  private handleEvent(event: LibmpvEvent): void {
    switch (event.event) {
      case 'property-change':
        this.handlePropertyChange(event);
        break;
      case 'file-loaded':
        // The file was loaded again behind our back (the readback fallback reloads it): the position it asked for is lost otherwise
        if (this.failedSeek) {
          const command = this.failedSeek;
          this.failedSeek = null;
          void this.sendCommand(command);
        }
        break;
      case 'seek':
        this.pendingSeeks++;
        break;
      case 'playback-restart':
        this.emit('status', {event: 'playback-restart'});
        // Consumers expect 'seek' after the 'playback-restart' that the seek triggers. mpv coalesces quick
        // seeks into one restart, so one 'seek' per restart.
        if (this.pendingSeeks > 0) {
          this.pendingSeeks = 0;
          this.emit('status', {event: 'seek'});
        }
        break;
      case 'shutdown':
        if (!this.stopping) {
          console.error('[LibmpvManager] libmpv shut down unexpectedly.');
          this.emit('error', new Error('libmpv shut down unexpectedly'));
        }
        break;
      case 'log-message':
        console.warn(`[libmpv] [${event.prefix}] ${event.text.trimEnd()}`);
        break;
    }
  }

  private handlePropertyChange(event: MpvProperty): void {
    const data = event.data ?? undefined;
    switch (event.name) {
      case 'time-pos':
        // Emitted by the 10 Hz timer instead, only while playing.
        this.timePos = typeof data === 'number' ? data : null;
        break;
      case 'pause':
        this.paused = data === true;
        this.emit('status', {event: 'property-change', name: 'pause', data});
        break;
      case 'user-data/auto-pause-fired':
        if (data) {
          this.emit('status', {event: 'auto-pause-fired', data});
        }
        break;
      case 'idle-active': {
        const idle = data === true;
        const wasLoaded = this.lastIdle === false;
        this.lastIdle = idle;
        if (idle && wasLoaded) {
          this.emit('status', {event: 'end-file'});
        }
        break;
      }
      default:
        this.emit('status', {event: 'property-change', name: event.name, data});
    }
  }

  private emitTimePos(): void {
    if (!this.paused && this.timePos !== null) {
      this.emit('status', {event: 'property-change', name: 'time-pos', data: this.timePos});
    }
  }

  /** Fire-and-forget callers never catch, so a failure (e.g. a seek during teardown) is logged, not thrown. */
  private async safely(what: string, action: (libmpv: Libmpv) => Promise<unknown>): Promise<void> {
    if (!this.libmpv) {
      console.warn(`[LibmpvManager] ${what} ignored: libmpv is not running.`);
      return;
    }
    try {
      await action(this.libmpv);
    } catch (error) {
      console.warn(`[LibmpvManager] ${what} failed:`, error instanceof Error ? error.message : error);
    }
  }

  public sendCommand(command: any[]): Promise<void> {
    const args = command.map(arg => String(arg));
    const isAbsoluteSeek = args[0] === 'seek' && args[2] === 'absolute';
    return this.safely(`Command ${command[0]}`, async libmpv => {
      try {
        await libmpv.command(args);
        if (isAbsoluteSeek) {
          this.failedSeek = null;
        }
      } catch (error) {
        if (isAbsoluteSeek) {
          this.failedSeek = args;
        }
        throw error;
      }
    });
  }

  public setProperty(property: string, value: any): Promise<void> {
    return this.safely(`Setting ${property}`, libmpv => libmpv.setProperty(property, value));
  }

  public async getProperty(property: string): Promise<any> {
    if (!this.libmpv) {
      throw new Error('libmpv is not running.');
    }
    return this.libmpv.getProperty(property);
  }

  public observeProperty(property: string): void {
    if (!this.libmpv) {
      console.error('Cannot observe property: libmpv is not running.');
      return;
    }
    if (this.observed.has(property)) {
      return;
    }
    this.observed.add(property);
    this.libmpv.observeProperty(property);
  }

  public showSubtitles(): Promise<void> {
    return this.setProperty('sub-visibility', true);
  }

  public hideSubtitles(): Promise<void> {
    return this.setProperty('sub-visibility', false);
  }

  public setLuaAutoPause(endTime: number, token: string): Promise<void> {
    return this.sendCommand(['script-message', 'set-auto-pause', endTime, token]);
  }

  private runDetachVideo(): void {
    const detach = this.detachVideo;
    this.detachVideo = null;
    try {
      detach?.();
    } catch (error) {
      console.warn('[LibmpvManager] Error while detaching the video output:', error);
    }
  }

  /** Idempotent. */
  public async stop(): Promise<void> {
    if (this.timeTimer) {
      clearInterval(this.timeTimer);
      this.timeTimer = null;
    }
    const libmpv = this.libmpv;
    if (!libmpv) {
      return;
    }
    this.stopping = true;
    this.libmpv = null;
    this.runDetachVideo();
    try {
      await libmpv.destroy();
    } catch (error) {
      console.warn('[LibmpvManager] Error while destroying libmpv:', error);
    }
  }
}
