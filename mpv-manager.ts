import {EventEmitter} from 'events';
import {app, type BrowserWindow} from 'electron';
import Mpv, {StatusObject} from 'node-mpv';
import type {SubtitleSelection} from './src/app/model/project.types';
import path from 'path';

const TIME_UPDATE_FPS = 60;

export class MpvManager extends EventEmitter {
  public mediaPath: string = '';
  private mpv: Mpv | null = null;

  constructor(private win: BrowserWindow) {
    super();
  }

  public async start(
    mediaPath: string,
    audioTrackIndex: number | null,
    subtitleSelection: SubtitleSelection,
    useMpvSubtitles: boolean
  ): Promise<void> {
    this.mediaPath = mediaPath;

    const options = {
      binary: this.getMpvExecutablePath(),
      time_update: (1 / TIME_UPDATE_FPS),
      // verbose: true
    };

    const args = [
      `--wid=${this.win.getNativeWindowHandle().readInt32LE(0)}`,
      '--no-config',
      '--vo=gpu',
      '--no-osc',
      '--no-osd-bar',
      '--no-border',
      '--input-default-bindings=no',
      '--keep-open=always',
      '--idle=yes',
      '--pause',
      `--sub-visibility=${useMpvSubtitles ? 'yes' : 'no'}`,
      '--hr-seek=yes',
      '--cache=no',
    ];

    if (audioTrackIndex !== null) {
      args.push(`--aid=${audioTrackIndex}`);
    }

    switch (subtitleSelection.type) {
      case 'embedded':
        args.push(`--sid=${subtitleSelection.trackIndex}`);
        break;
      case 'external':
        args.push(`--sub-file=${subtitleSelection.filePath}`);
        break;
      case 'none':
        // do nothing
        break;
    }

    this.mpv = new Mpv(options, args);
    this.setupEventListeners();

    try {
      await this.mpv.start();
      console.log('[MpvManager] MPV process started successfully.');

      await this.mpv.load(mediaPath, 'replace');
      console.log(`[MpvManager] Loaded media: ${mediaPath}`);

      this.emit('ready');
    } catch (error) {
      console.error('[MpvManager] Failed to start MPV or load file:', error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    if (!this.mpv) return;

    this.mpv.on('status', (status: StatusObject) => {
      this.emit('status', {
        event: 'property-change',
        name: status.property,
        data: status.value,
      });
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
    });

    this.mpv.on('stopped', () => {
      this.emit('status', {event: 'end-file'});
    });

    this.mpv.on('crashed', () => {
      const err = new Error('MPV process has crashed.');
      console.error(`[MpvManager] MPV process crashed.`);
      this.emit('error', err);
    });
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
    if (this.mpv) {
      this.mpv.quit();
      this.mpv = null;
    }
  }

  private getMpvExecutablePath(): string {
    const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const platform = process.platform;
    let executablePath = '';

    if (platform === 'win32') {
      executablePath = path.join(basePath, 'electron-resources', 'windows', 'mpv', 'mpv.exe');
    } else if (platform === 'darwin') { // macOS
      executablePath = path.join(basePath, 'electron-resources', 'mac', 'mpv', 'mpv');
    } else { // linux
      executablePath = path.join(basePath, 'electron-resources', 'linux', 'mpv', 'mpv');
    }

    return executablePath;
  }
}
