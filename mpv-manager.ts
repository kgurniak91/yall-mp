import {EventEmitter} from 'events';
import {ChildProcess, spawn} from 'child_process';
import type {Socket} from 'net';
import net from 'net';
import {app, type BrowserWindow} from 'electron';
import path from 'path';

export class MpvManager extends EventEmitter {
  private mpvProcess: ChildProcess | null = null;
  private client: Socket | null = null;
  private ipcPath: string;

  constructor(private win: BrowserWindow) {
    super();
    if (process.platform === 'win32') {
      this.ipcPath = `\\\\.\\pipe\\mpv-ipc-socket-${Date.now()}`;
    } else {
      this.ipcPath = `/tmp/mpv-ipc-socket-${Date.now()}`;
    }
  }

  public async start(mediaPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const mpvExecutable = this.getMpvExecutablePath();
      const args = [
        `--input-ipc-server=${this.ipcPath}`,
        `--wid=${this.win.getNativeWindowHandle().readInt32LE(0)}`,
        "--no-osc",
        "--no-osd-bar",
        "--input-default-bindings=no",
        "--keep-open=always",
        "--idle=yes",
        "--pause",
        mediaPath // The file to play
      ];

      this.mpvProcess = spawn(mpvExecutable, args);

      this.mpvProcess.on('error', (err) => {
        console.error('Failed to start MPV process.', err);
        this.emit('error', err);
        reject(err);
      });

      this.mpvProcess.on('close', (code) => {
        console.log(`MPV process exited with code ${code}`);
        this.emit('close');
        this.cleanup();
      });

      // Give MPV a moment to create the IPC socket, then try to connect.
      setTimeout(() => this.connect(resolve, reject), 200);
    });
  }

  private connect(resolve: () => void, reject: (err: Error) => void) {
    this.client = net.createConnection(this.ipcPath, () => {
      console.log('Connected to MPV IPC server.');
      this.emit('ready');
      resolve();
    });

    this.client.on('data', (data) => {
      // Data from MPV can contain multiple JSON objects, separated by newlines.
      const messages = data.toString().trim().split('\n');
      for (const message of messages) {
        try {
          const parsed = JSON.parse(message);
          this.emit('status', parsed); // Emit every event
        } catch (e) {
          console.warn('Could not parse MPV message:', message);
        }
      }
    });

    this.client.on('error', (err) => {
      console.error('MPV IPC connection error:', err);
      this.emit('error', err);
      reject(err);
    });
  }

  public sendCommand(command: any[]): void {
    if (!this.client) return;
    const cmd = {command};
    this.client.write(JSON.stringify(cmd) + '\n');
  }

  public setProperty(property: string, value: any): void {
    this.sendCommand(['set_property', property, value]);
  }

  public observeProperty(property: string): void {
    this.sendCommand(['observe_property', 1, property]); // Using 1 as a unique request ID
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
