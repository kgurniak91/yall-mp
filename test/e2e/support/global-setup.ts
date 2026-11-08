import {spawn, type ChildProcess} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_DIR = path.resolve(__dirname, '../../../e2e-artifacts');

// Kept on globalThis so global-teardown (same process) can stop it
export const recorderKey = '__yallE2eRecorder';

function recorderArgs(output: string): string[] | null {
  switch (process.platform) {
    case 'win32':
      return ['-f', 'gdigrab', '-framerate', '10', '-i', 'desktop', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', output];
    case 'linux':
      return ['-f', 'x11grab', '-framerate', '10', '-video_size', '1920x1080', '-i', process.env['DISPLAY'] ?? ':99', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', output];
    case 'darwin':
      return ['-f', 'avfoundation', '-framerate', '10', '-i', '1:none', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', output];
    default:
      return null;
  }
}

/** Optional full-desktop recording, active only with E2E_RECORD_DESKTOP=1. A failure to start is logged, never fatal. */
export default async function globalSetup(): Promise<void> {
  if (process.env['E2E_RECORD_DESKTOP'] !== '1') {
    return;
  }

  try {
    fs.mkdirSync(ARTIFACTS_DIR, {recursive: true});
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const output = path.join(ARTIFACTS_DIR, `desktop-${platform}.mkv`);
    const args = recorderArgs(output);
    if (!args) {
      console.log(`[e2e] Desktop recording is not supported on ${process.platform}`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath: string = require('ffmpeg-static');
    const proc = spawn(ffmpegPath, ['-y', ...args], {stdio: ['pipe', 'ignore', 'pipe']});
    let stderr = '';
    proc.stderr?.on('data', chunk => stderr = (stderr + chunk).slice(-2000));
    proc.on('exit', code => {
      if (code !== 0 && code !== null) {
        console.log(`[e2e] Desktop recorder exited with code ${code}:\n${stderr}`);
      }
    });
    proc.on('error', err => console.log(`[e2e] Desktop recorder failed to start: ${err.message}`));

    (globalThis as Record<string, unknown>)[recorderKey] = proc;
    console.log(`[e2e] Recording desktop to ${output}`);
  } catch (err) {
    console.log(`[e2e] Could not start desktop recording: ${(err as Error).message}`);
  }
}

export type Recorder = ChildProcess | undefined;
