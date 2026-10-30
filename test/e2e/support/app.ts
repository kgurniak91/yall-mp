import {_electron, test as base, type ElectronApplication, type Page} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface LaunchOptions {
  /** Called with the fresh userData dir before the app starts, e.g. to seed a project */
  seed?: (userDataDir: string) => void;
  /** Files passed on the command line (open-with flow) */
  files?: string[];
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  ui: Page;
  userDataDir: string;
  /** Uncaught renderer exceptions collected so far */
  pageErrors: string[];
  /** What the main process printed (stdout and stderr), capped; attached to the report when the test fails */
  mainLog: () => string;
}

export async function getUiPage(app: ElectronApplication, timeoutMs = process.platform === 'darwin' ? 60_000 : 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const url = page.url();
      if (!url.includes('/dist/yall-mp/browser/')) {
        continue;
      }

      try {
        if (await page.evaluate(() => typeof (window as any).electronAPI?.windowMinimize === 'function')) {
          return page;
        }
      } catch {
        // The page is still navigating or is not a renderer we can evaluate in yet
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for the UI window');
}

/** Gives up on a call that hangs when the app is stuck (a slow runner, a window that never came up), so the worker can shut down. */
async function withinTime<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([work, new Promise<undefined>(r => setTimeout(() => r(undefined), ms))]);
}

async function closeApp(app: ElectronApplication): Promise<void> {
  let proc;
  try {
    proc = app.process();
  } catch {
    return; // The app already exited, e.g. the test closed the window itself
  }
  const closed = app.close().catch(() => undefined);
  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise<boolean>(r => setTimeout(() => r(true), 10_000))
  ]);
  if (timedOut) {
    proc.kill('SIGKILL');
  }
}

const MAIN_LOG_LIMIT = 400_000;

export const test = base.extend<{ launch: (opts?: LaunchOptions) => Promise<LaunchedApp> }>({
  launch: async ({}, use, testInfo) => {
    const launched: LaunchedApp[] = [];

    await use(async (opts = {}) => {
      const userDataDir = testInfo.outputPath(`userData-${launched.length}`);
      fs.mkdirSync(userDataDir, {recursive: true});
      opts.seed?.(userDataDir);

      const app = await _electron.launch({
        args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(opts.files ?? [])],
        cwd: REPO_ROOT,
        env: {
          ...process.env as Record<string, string>,
          YALL_MP_E2E: '1',
          YALL_MP_USER_DATA_DIR: userDataDir,
          ...opts.env
        }
        // No recordVideo: it hangs _electron.launch with this window stack; traces + desktop recording cover it
      });
      await app.context().tracing.start({screenshots: true, snapshots: true});

      const chunks: string[] = [];
      let size = 0;
      const collect = (data: Buffer) => {
        if (size < MAIN_LOG_LIMIT) {
          const text = data.toString();
          size += text.length;
          chunks.push(text);
        }
      };
      app.process().stdout?.on('data', collect);
      app.process().stderr?.on('data', collect);

      let ui: Page;
      try {
        ui = await getUiPage(app);
      } catch (error) {
        // Keep what the app printed, and do not leave it running for the worker teardown to wait on
        await testInfo.attach('main-process-launch.log', {body: chunks.join(''), contentType: 'text/plain'});
        // Retried tests drop their attachments, so a launch that never showed its window is also printed
        console.log(`[e2e] no UI window for ${testInfo.title}; windows: ${JSON.stringify(app.windows().map(w => w.url()))}; app output:
${chunks.join('').slice(-4000)}`);
        await closeApp(app);
        throw error;
      }
      const pageErrors: string[] = [];
      ui.on('pageerror', err => pageErrors.push(err.message));

      const result = {app, ui, userDataDir, pageErrors, mainLog: () => chunks.join('')};
      launched.push(result);
      return result;
    });

    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [i, l] of launched.entries()) {
      try {
        const tracePath = testInfo.outputPath(`trace-${i}.zip`);
        await withinTime(l.app.context().tracing.stop({path: failed ? tracePath : undefined}), 20_000);
        if (failed && fs.existsSync(tracePath)) {
          await testInfo.attach(`trace-${i}`, {path: tracePath, contentType: 'application/zip'});
        }
        if (failed) {
          await testInfo.attach(`main-process-${i}.log`, {body: l.mainLog(), contentType: 'text/plain'});
        }
      } catch {
        // The app may already be gone
      }
      await closeApp(l.app);
    }

    // Surface uncaught renderer exceptions after the app has shut down cleanly
    const errors = launched.flatMap(l => l.pageErrors);
    if (errors.length > 0 && !failed) {
      throw new Error(`Uncaught renderer exceptions:\n${errors.join('\n')}`);
    }
  }
});

export {expect} from '@playwright/test';
