import {EventEmitter} from 'events';
import {app} from 'electron';
import Mpv, {StatusObject} from 'node-mpv';
import type {SubtitleSelection} from './src/app/model/project.types';
import path from 'path';
import os from 'os';
import {MediaTrack} from './shared/types/media.type';
import {execSync} from 'child_process';
import * as fs from 'fs';
import type {MpvHost} from './video-surface';
import type {MpvEmbedEvent} from './mpv-embed';

const TIME_UPDATE_FPS = 10;

let embeddedSocketCounter = 0;

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) {
      throw new Error(`mpv IPC socket did not appear at ${filePath} within ${timeoutMs} ms.`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export class MpvManager extends EventEmitter {
  public mediaPath: string = '';
  public customMpvPath?: string;
  private mpv: Mpv | null = null;
  private isStopping = false;
  private readonly usesEmbeddedMpv: boolean;

  constructor(private host: MpvHost) {
    super();
    this.usesEmbeddedMpv = typeof host.createEmbeddedMpv === 'function';
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
    this.isStopping = false;

    const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const scriptPath = path.join(basePath, 'mpv', 'yall_auto_pause.lua');

    // Options shared by both modes, as [name, value] pairs. The process mode
    // turns them into `--name=value` arguments; the embedded mode applies them
    // with mpv_set_option_string before mpv_initialize.
    const options: [string, string][] = [
      ['config', 'no'],
      ['hwdec', hardwareAcceleration ? 'auto' : 'no'],
      ['osc', 'no'],
      ['osd-bar', 'no'],
      ['input-default-bindings', 'no'],
      ['keep-open', 'always'],
      ['idle', 'yes'],
      ['pause', 'yes'],
      ['sub-visibility', 'no'],
      ['hr-seek', 'default'],
      ['hr-seek-framedrop', 'yes'],
      ['cache', 'no'],
      ['vd-lavc-threads', '0'],          // Use all available CPU cores for decoding
      ['demuxer-max-bytes', '150MiB'],   // Increase demuxer cache
      ['demuxer-readahead-secs', '20'],  // Prefetch more data
      ['framedrop', 'vo'],               // Drop frames visually if rendering is too slow to maintain sync
      ['vd-lavc-fast', 'yes'],           // Allow optimizations that might slightly violate spec but improve speed
      ['sws-allow-zimg', 'no'],          // Disable zimg (can be slow/buggy on old systems), fallback to swscale
      ['volume', String(volume)],
      ['mute', isMuted ? 'yes' : 'no'],
    ];

    if (audioTrackIndex !== null) {
      options.push(['aid', String(audioTrackIndex)]);
    }

    let mpvRelativeSubtitleIndex: number | undefined = undefined;
    if (subtitleSelection.type === 'embedded') {
      // Find the 0-based position of the selected track within the list of ONLY subtitle tracks:
      const relativeIndex = allSubtitleTracks.findIndex(track => track.index === subtitleSelection.trackIndex);
      if (relativeIndex !== -1) {
        // MPV's relative track IDs are 1-based:
        mpvRelativeSubtitleIndex = (relativeIndex + 1);
        options.push(['sid', String(mpvRelativeSubtitleIndex)]);
        console.log(`[MpvManager] Mapped ffprobe absolute index ${subtitleSelection.trackIndex} to mpv relative index ${mpvRelativeSubtitleIndex}`);
      } else {
        console.warn(`[MpvManager] Could not find selected subtitle track index ${subtitleSelection.trackIndex} in the provided list.`);
      }
    }

    if (this.usesEmbeddedMpv) {
      await this.startEmbedded(options, scriptPath);
    } else {
      this.startProcess(options, scriptPath);
    }
    this.setupEventListeners();

    try {
      await this.mpv!.start();
      console.log(`[MpvManager] MPV ${this.usesEmbeddedMpv ? 'library' : 'process'} started successfully.`);

      // Shared properties from custom Lua script:
      this.mpv!.observeProperty('user-data/auto-pause-fired');

      // Observe EOF state to handle end of file cleanly
      this.mpv!.observeProperty('eof-reached');

      await this.mpv!.load(mediaPath, 'replace');
      console.log(`[MpvManager] Loaded media: ${mediaPath}`);

      if (subtitleSelection.type === 'external') {
        await this.mpv!.addSubtitles(subtitleSelection.filePath, 'select');
        console.log(`[MpvManager] Added external subtitles: ${subtitleSelection.filePath}`);
      } else if (subtitleSelection.type === 'embedded' && mpvRelativeSubtitleIndex != null) {
        await this.mpv!.selectSubtitles(mpvRelativeSubtitleIndex);
        console.log(`[MpvManager] Selected embedded subtitle track: ${mpvRelativeSubtitleIndex}`);
      }

      if (useMpvSubtitles) {
        if (subtitlesVisible) {
          await this.showSubtitles();
        } else {
          await this.hideSubtitles();
        }
      } else {
        await this.hideSubtitles();
      }

      this.emit('ready');
    } catch (error) {
      console.error('[MpvManager] Failed to start MPV or load file:', error);
      throw error;
    }
  }

  /**
   * Windows/Linux: spawn the mpv executable and let it draw into the surface's
   * native window (`--wid`). node-mpv starts the process and connects to its IPC socket.
   */
  private startProcess(options: [string, string][], scriptPath: string): void {
    const windowId = this.host.getMpvWindowId();
    if (windowId === null) {
      throw new Error('The video surface does not provide a native window id for mpv.');
    }

    const args = [
      `--wid=${windowId}`,
      `--script=${scriptPath}`,
      '--vo=gpu,xv,x11',
      '--no-border',
      '--ontop=no',
      '--force-window=yes',
      ...options.map(([name, value]) => `--${name}=${value}`),
    ];

    this.mpv = new Mpv({
      binary: this.getMpvExecutablePath(),
      time_update: (1 / TIME_UPDATE_FPS),
      // verbose: true
    }, args);
  }

  /**
   * macOS: libmpv runs inside this process and paints into a native view (see
   * video-surface.ts). It still opens an IPC socket, which node-mpv attaches
   * to instead of spawning a process, so every command below works unchanged.
   */
  private async startEmbedded(options: [string, string][], scriptPath: string): Promise<void> {
    const socketPath = path.join(os.tmpdir(), `yall-mpv-${process.pid}-${++embeddedSocketCounter}.sock`);

    const embeddedOptions: [string, string][] = [
      ['scripts', scriptPath],
      ['input-ipc-server', socketPath],
      ...options,
    ];

    const info = this.host.createEmbeddedMpv!(embeddedOptions, (event) => this.handleEmbeddedEvent(event));
    console.log(`[MpvManager] libmpv loaded from ${info.libmpvPath} (renderer: ${info.renderer})`);
    if (info.rejectedOptions.length > 0) {
      console.warn(`[MpvManager] libmpv rejected options: ${info.rejectedOptions.join(', ')}`);
    }

    // libmpv binds the IPC socket on its own thread shortly after
    // mpv_initialize returns. node-mpv must find it there, otherwise it would
    // try to spawn an mpv executable instead of attaching.
    await waitForFile(socketPath, 3000);

    this.mpv = new Mpv({
      socket: socketPath,
      time_update: (1 / TIME_UPDATE_FPS),
    });
  }

  private handleEmbeddedEvent(event: MpvEmbedEvent): void {
    switch (event.type) {
      case 'log':
        console.log(`[mpv${event.prefix ? '/' + event.prefix : ''}] ${event.level}: ${event.text}`);
        break;
      case 'render-error':
        console.error(`[MpvManager] ${event.text}`);
        break;
      case 'shutdown':
        if (!this.isStopping) {
          console.error('[MpvManager] libmpv shut down unexpectedly.');
          this.emit('error', new Error('MPV has shut down.'));
        }
        break;
    }
  }

  private setupEventListeners(): void {
    if (!this.mpv) {
      return;
    }

    this.mpv.on('status', (status: StatusObject) => {
      const prop = status.property as any;
      if (prop === 'user-data/auto-pause-fired') {
        this.emit('status', {event: 'auto-pause-fired', data: status.value});
      } else {
        this.emit('status', {
          event: 'property-change',
          name: status.property,
          data: status.value,
        });
      }
    });

    this.mpv.on('timeposition', (time: number) => {
      this.emit('status', {
        event: 'property-change',
        name: 'time-pos',
        data: time,
      });
    });

    this.mpv.on('paused', () => {
      this.emit('status', {
        event: 'property-change',
        name: 'pause',
        data: true,
      });
    });

    this.mpv.on('resumed', () => {
      this.emit('status', {
        event: 'property-change',
        name: 'pause',
        data: false,
      });
    });

    this.mpv.on('seek', () => {
      this.emit('status', {event: 'seek'});
    });

    this.mpv.on('started', () => {
      this.emit('status', {event: 'playback-restart'});
      this.logDecoderOnce();
    });

    this.mpv.on('stopped', () => {
      this.emit('status', {event: 'end-file'});
    });

    this.mpv.on('crashed', () => {
      if (this.isStopping) {
        // Embedded mode: the socket closes when we tear libmpv down ourselves.
        return;
      }
      const err = new Error('MPV process has crashed.');
      console.error(`[MpvManager] MPV process crashed.`);
      this.emit('error', err);
    });
  }

  private decoderLogged = false;

  /** One log line saying which video decoder mpv ended up with (hardware or software). */
  private async logDecoderOnce(): Promise<void> {
    if (this.decoderLogged || !this.mpv) {
      return;
    }
    this.decoderLogged = true;
    try {
      const [hwdec, codec, width, height, fps] = await Promise.all([
        this.mpv.getProperty('hwdec-current').catch(() => 'unknown'),
        this.mpv.getProperty('video-codec').catch(() => 'unknown'),
        this.mpv.getProperty('video-params/w').catch(() => '?'),
        this.mpv.getProperty('video-params/h').catch(() => '?'),
        this.mpv.getProperty('container-fps').catch(() => '?'),
      ]);
      console.log(`[MpvManager] Video: ${codec}, ${width}x${height} @ ${fps} fps, hwdec: ${hwdec || 'no (software decoding)'}`);
    } catch (e) {
      // Diagnostics only.
    }
  }

  public sendCommand(command: any[]): Promise<any> {
    if (!this.mpv) {
      return Promise.reject(new Error('MPV is not running.'));
    }

    const [commandName, ...args] = command;
    const stringArgs = args.map(arg => String(arg));
    return this.mpv.command(commandName, stringArgs);
  }

  public async setProperty(property: string, value: any): Promise<void> {
    if (!this.mpv) {
      throw new Error('MPV is not running.');
    }
    await this.mpv.setProperty(property, value);
  }

  public getProperty(property: string): Promise<any> {
    if (!this.mpv) {
      return Promise.reject(new Error('MPV is not running.'));
    }
    return this.mpv.getProperty(property);
  }

  public observeProperty(property: string): void {
    if (!this.mpv) {
      console.error('Cannot observe property: MPV is not running.');
      return;
    }
    this.mpv.observeProperty(property);
  }

  public stop(): void {
    if (!this.mpv) {
      return;
    }
    this.isStopping = true;

    if (this.usesEmbeddedMpv) {
      // node-mpv's quit() only works for processes it spawned itself, so
      // detach its socket and let the surface terminate libmpv.
      const client = this.mpv as any;
      clearInterval(client.timepositionListenerId);
      try {
        client.socket?.quit?.();
      } catch (e) {
        // The socket may already be gone.
      }
      client.running = false;
      this.mpv = null;
      this.host.destroyEmbeddedMpv?.();
      return;
    }

    this.mpv.quit();
    this.mpv = null;
  }

  public showSubtitles(): Promise<void> {
    if (!this.mpv) {
      return Promise.reject(new Error('MPV is not running.'));
    }
    return this.mpv.showSubtitles();
  }

  public hideSubtitles(): Promise<void> {
    if (!this.mpv) {
      return Promise.reject(new Error('MPV is not running.'));
    }
    return this.mpv.hideSubtitles();
  }

  public setLuaAutoPause(endTime: number, token: string): void {
    this.mpv?.command('script-message', ['set-auto-pause', endTime.toString(), token]);
  }

  private getMpvExecutablePath(): string {
    if (this.customMpvPath && fs.existsSync(this.customMpvPath)) {
      return this.customMpvPath;
    } else if (this.customMpvPath) {
      console.warn(`[MpvManager] Custom MPV path invalid: ${this.customMpvPath}. Falling back to default.`);
    }

    const platform = process.platform;

    // On Windows, use the downloaded binary
    if (platform === 'win32') {
      const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
      return path.join(basePath, 'electron-resources', 'windows', 'mpv.exe');
    }

    // On macOS/Linux, resolve absolute system path
    try {
      // Try the 'which' command first (works for most Linux terminal starts)
      const resolvedPath = execSync('which mpv').toString().trim();
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    } catch (e) {
      // 'which' failed (common in macOS GUI apps or restrictive Linux envs)
    }

    // Fallback: Check common install locations manually
    const commonPaths = [
      '/usr/bin/mpv',           // Standard Linux
      '/usr/local/bin/mpv',     // Intel Mac / Linux user
      '/opt/homebrew/bin/mpv',  // Apple Silicon Mac
      '/sw/bin/mpv'             // Fink/MacPorts
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Last resort - the global PATH
    return 'mpv';
  }
}
