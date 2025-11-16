import {EventEmitter} from 'events';
import {app, type BrowserWindow} from 'electron';
import Mpv, {StatusObject} from 'node-mpv';
import type {SubtitleSelection} from './src/app/model/project.types';
import path from 'path';
import {MediaTrack} from './shared/types/media.type';

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
    allSubtitleTracks: MediaTrack[],
    useMpvSubtitles: boolean,
    subtitlesVisible: boolean,
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
      '--sub-visibility=no',
      '--hr-seek=yes',
      '--cache=no',
    ];

    if (audioTrackIndex !== null) {
      args.push(`--aid=${audioTrackIndex}`);
    }

    let mpvRelativeSubtitleIndex: number | undefined = undefined;
    if (subtitleSelection.type === 'embedded') {
      // Find the 0-based position of the selected track within the list of ONLY subtitle tracks:
      const relativeIndex = allSubtitleTracks.findIndex(track => track.index === subtitleSelection.trackIndex);
      if (relativeIndex !== -1) {
        // MPV's relative track IDs are 1-based:
        mpvRelativeSubtitleIndex = (relativeIndex + 1);
        args.push(`--sid=${mpvRelativeSubtitleIndex}`);
        console.log(`[MpvManager] Mapped ffprobe absolute index ${subtitleSelection.trackIndex} to mpv relative index ${mpvRelativeSubtitleIndex}`);
      } else {
        console.warn(`[MpvManager] Could not find selected subtitle track index ${subtitleSelection.trackIndex} in the provided list.`);
      }
    }

    this.mpv = new Mpv(options, args);
    this.setupEventListeners();

    try {
      await this.mpv.start();
      console.log('[MpvManager] MPV process started successfully.');

      await this.mpv.load(mediaPath, 'replace');
      console.log(`[MpvManager] Loaded media: ${mediaPath}`);

      if (subtitleSelection.type === 'external') {
        await this.mpv.addSubtitles(subtitleSelection.filePath, 'select');
        console.log(`[MpvManager] Added external subtitles: ${subtitleSelection.filePath}`);
      } else if (subtitleSelection.type === 'embedded' && mpvRelativeSubtitleIndex != null) {
        await this.mpv.selectSubtitles(mpvRelativeSubtitleIndex);
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

  private getMpvExecutablePath(): string {
    const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const platform = process.platform;
    let executablePath = '';

    if (platform === 'win32') {
      executablePath = path.join(basePath, 'electron-resources', 'windows', 'mpv.exe');
    } else if (platform === 'darwin') { // macOS
      executablePath = path.join(basePath, 'electron-resources', 'mac', 'mpv');
    } else { // linux
      executablePath = path.join(basePath, 'electron-resources', 'linux', 'mpv');
    }

    return executablePath;
  }
}
