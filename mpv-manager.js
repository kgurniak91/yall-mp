"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MpvManager = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const net_1 = __importDefault(require("net"));
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
class MpvManager extends events_1.EventEmitter {
    win;
    mpvProcess = null;
    client = null;
    ipcPath;
    constructor(win) {
        super();
        this.win = win;
        if (process.platform === 'win32') {
            this.ipcPath = `\\\\.\\pipe\\mpv-ipc-socket-${Date.now()}`;
        }
        else {
            this.ipcPath = `/tmp/mpv-ipc-socket-${Date.now()}`;
        }
    }
    async start(mediaPath) {
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
            this.mpvProcess = (0, child_process_1.spawn)(mpvExecutable, args);
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
    connect(resolve, reject) {
        this.client = net_1.default.createConnection(this.ipcPath, () => {
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
                }
                catch (e) {
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
    sendCommand(command) {
        if (!this.client)
            return;
        const cmd = { command };
        this.client.write(JSON.stringify(cmd) + '\n');
    }
    setProperty(property, value) {
        this.sendCommand(['set_property', property, value]);
    }
    observeProperty(property) {
        this.sendCommand(['observe_property', 1, property]); // Using 1 as a unique request ID
    }
    stop() {
        if (this.mpvProcess) {
            this.mpvProcess.kill();
        }
        this.cleanup();
    }
    resize(rect) {
        // MPV's geometry property format is "WxH+X+Y"
        const geometry = `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
        this.setProperty('geometry', geometry);
    }
    getMpvExecutablePath() {
        const basePath = electron_1.app.isPackaged ? process.resourcesPath : electron_1.app.getAppPath();
        const platform = process.platform;
        let executablePath = '';
        if (platform === 'win32') {
            executablePath = path_1.default.join(basePath, 'electron-resources', 'windows', 'mpv', 'mpv.exe');
        }
        else if (platform === 'darwin') { // macOS
            executablePath = path_1.default.join(basePath, 'electron-resources', 'mac', 'mpv', 'mpv');
        }
        else { // linux
            executablePath = path_1.default.join(basePath, 'electron-resources', 'linux', 'mpv', 'mpv');
        }
        return executablePath;
    }
    cleanup() {
        this.client?.end();
        this.client = null;
        this.mpvProcess = null;
    }
}
exports.MpvManager = MpvManager;
//# sourceMappingURL=mpv-manager.js.map