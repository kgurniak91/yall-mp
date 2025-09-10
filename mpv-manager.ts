import {EventEmitter} from 'events';
import {ChildProcess, spawn} from 'child_process';
import type {Socket} from 'net';
import net from 'net';
import {app, type BrowserWindow} from 'electron';
import {SubtitleSelection} from './src/app/model/project.types';
import path from 'path';

export class MpvManager extends EventEmitter {
  public mediaPath: string = '';
  private mpvProcess: ChildProcess | null = null;
  private client: Socket | null = null;
  private ipcPath: string;
  private requestId = 2;
  private readonly pendingRequests = new Map<number, (value: any) => void>();

  constructor(private win: BrowserWindow) {
    super();
    this.ipcPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\mpv-ipc-socket-${Date.now()}`
      : `/tmp/mpv-ipc-socket-${Date.now()}`;
  }

  public async start(
    mediaPath: string,
    audioTrackIndex: number | null,
    subtitleSelection: SubtitleSelection,
    useMpvSubtitles: boolean
  ): Promise<void> {
    
    this.mediaPath = mediaPath;
    return new Promise((resolve, reject) => {
      const mpvExecutable = this.getMpvExecutablePath();
      const args = [
        `--input-ipc-server=${this.ipcPath}`,
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
        mediaPath
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

      this.mpvProcess = spawn(mpvExecutable, args);

      this.mpvProcess.on('error', (err) => {
        reject(new Error(`Failed to start MPV process: ${err.message}`));
      });

      this.mpvProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`MPV process exited prematurely with code ${code}`));
        }
      });

      let retries = 0;
      const maxRetries = 10; // Try for 2 seconds (10 * 200ms)

      const tryConnect = () => {
        this.client = net.createConnection(this.ipcPath, () => {
          console.log('[MpvManager] Successfully connected to MPV IPC server.');
          this.emit('ready');

          this.client?.on('data', (data) => {
            const messages = data.toString().trim().split('\n');
            for (const message of messages) {
              try {
                const json = JSON.parse(message);
                // Check if this message is a response to a specific request
                if (json.request_id && this.pendingRequests.has(json.request_id)) {
                  // Fulfill the promise associated with this request
                  this.pendingRequests.get(json.request_id)?.(json.data);
                  this.pendingRequests.delete(json.request_id);
                } else {
                  // Otherwise, it's a general status event
                  this.emit('status', json);
                }
              } catch (e) { /* ignore */ }
            }
          });

          resolve();
        });

        this.client.on('error', (err) => {
          retries++;
          if (retries < maxRetries) {
            setTimeout(tryConnect, 200);
          } else {
            reject(new Error(`Failed to connect to MPV IPC socket after ${maxRetries} retries. MPV may have crashed.`));
          }
        });
      };

      tryConnect();
    });
  }

  public sendCommand(command: any[]): void {
    if (!this.client) {
      console.error('[MpvManager] ERROR: Attempted to send command but IPC client is not connected!');
      return;
    }
    console.log('[MpvManager] Writing command to socket:', JSON.stringify({command}));
    const cmd = {command};
    this.client.write(JSON.stringify(cmd) + '\n');
  }

  public setProperty(property: string, value: any): void {
    this.sendCommand(['set_property', property, value]);
  }

  public getProperty(property: string): Promise<any> {
    return new Promise((resolve) => {
      const reqId = this.requestId++;
      this.pendingRequests.set(reqId, resolve);
      // Send the command with unique request_id
      const command = {command: ['get_property', property], request_id: reqId};
      this.client?.write(JSON.stringify(command) + '\n');
    });
  }

  public observeProperty(property: string): void {
    // request_id of 1 is reserved for observed properties by convention
    const command = {command: ['observe_property', 1, property]};
    this.client?.write(JSON.stringify(command) + '\n');
  }

  public stop(): void {
    if (this.mpvProcess) {
      this.mpvProcess.kill();
    }
    this.cleanup();
  }

  public resize(rect: { x: number, y: number, width: number, height: number }): void {
    // MPV's geometry property format is "WxH+X+Y"
    const geometry = `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
    this.setProperty('geometry', geometry);
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

  private cleanup(): void {
    this.client?.end();
    this.client = null;
    this.mpvProcess = null;
  }
}
