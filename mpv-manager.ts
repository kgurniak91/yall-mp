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
    this.ipcPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\mpv-ipc-socket-${Date.now()}`
      : `/tmp/mpv-ipc-socket-${Date.now()}`;
  }

  public async start(mediaPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const mpvExecutable = this.getMpvExecutablePath();
      const args = [
        `--input-ipc-server=${this.ipcPath}`,
        `--wid=${this.win.getNativeWindowHandle().readInt32LE(0)}`,
        '--vo=gpu',
        '--no-osc',
        '--no-osd-bar',
        '--no-border',
        '--input-default-bindings=no',
        '--keep-open=always',
        '--idle=yes',
        '--pause',
        "--sub-visibility=no",
        mediaPath
      ];

      this.mpvProcess = spawn(mpvExecutable, args);

      this.mpvProcess.on('error', (err) => {
        reject(new Error(`Failed to start MPV process: ${err.message}`));
      });

      this.mpvProcess.on('close', (code) => {
        // Reject if process exits before connection
        reject(new Error(`MPV process exited prematurely with code ${code}`));
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
              try { this.emit('status', JSON.parse(message)); } catch (e) { /* ignore */ }
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
