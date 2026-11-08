import type {ChildProcess} from 'child_process';
import {recorderKey} from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const proc = (globalThis as Record<string, unknown>)[recorderKey] as ChildProcess | undefined;
  if (!proc || proc.exitCode !== null) {
    return;
  }

  await new Promise<void>(resolve => {
    const guard = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 10_000);
    proc.once('exit', () => {
      clearTimeout(guard);
      resolve();
    });
    // 'q' makes ffmpeg finalize the file; mkv survives an abrupt stop anyway
    proc.stdin?.write('q');
    proc.stdin?.end();
  });
}
