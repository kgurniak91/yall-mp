// Shared setup for the native addon integration tests. If the addon or libmpv is missing the suites
// skip with the reason, unless YALL_NATIVE_REQUIRED=1 (set in CI), where the missing piece fails the run.
import * as fs from 'fs';
import * as path from 'path';
import {describe} from 'vitest';
import {
  ApiVersion,
  Libmpv,
  LibmpvEvent,
  libmpvCandidates,
  loadLibmpv,
  loadLibmpvAddon,
  NativeAddon
} from '../../../libmpv-bridge';

export const ROOT = path.resolve(__dirname, '..', '..', '..');
export const SAMPLE_MP4 = path.join(ROOT, 'test', 'e2e', 'fixtures', 'sample.mp4');
export const SAMPLE_51_MKV = path.join(ROOT, 'test', 'e2e', 'fixtures', 'sample-5.1.mkv');
export const AUTO_PAUSE_LUA = path.join(ROOT, 'mpv', 'yall_auto_pause.lua');

export interface NativeEnv {
  addon: NativeAddon;
  libraryPath: string;
  apiVersion: ApiVersion;
}

const required = process.env['YALL_NATIVE_REQUIRED'] === '1';

const tryLoad = (): { env?: NativeEnv; skipReason?: string } => {
  try {
    const addon = loadLibmpvAddon({appRoot: ROOT});
    const candidates = libmpvCandidates({
      basePath: ROOT,
      customPath: process.env['YALL_LIBMPV_PATH'] || undefined
    });
    const loaded = loadLibmpv(addon, candidates);
    return {env: {addon, libraryPath: loaded.path, apiVersion: loaded.apiVersion}};
  } catch (error) {
    if (required) {
      throw error;
    }
    return {skipReason: (error as Error).message};
  }
};

/** `describe` that skips (with the reason) when the addon or libmpv is not available. */
export const describeNative = (name: string, factory: (env: NativeEnv) => void): void => {
  const loaded = tryLoad();
  if (!loaded.env) {
    describe.skip(`${name} (skipped: ${loaded.skipReason?.split('\n')[0]})`, () => undefined);
    return;
  }
  const env = loaded.env;
  describe(name, () => factory(env));
};

/** Like `describeNative`, but only needs the addon: the test itself decides which libmpv to load. */
export const describeAddon = (name: string, factory: (addon: NativeAddon) => void): void => {
  try {
    const addon = loadLibmpvAddon({appRoot: ROOT});
    describe(name, () => factory(addon));
  } catch (error) {
    if (required) {
      throw error;
    }
    describe.skip(`${name} (skipped: ${(error as Error).message.split('\n')[0]})`, () => undefined);
  }
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const waitFor = async (predicate: () => boolean, timeoutMs = 10000, what = 'condition'): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(10);
  }
};

/** Headless options: no video output, no audio output, the auto-pause script, no config or key bindings. */
export const headlessOptions = (extra: Record<string, string> = {}): Record<string, string> => ({
  vo: 'null',
  ao: 'null',
  idle: 'yes',
  pause: 'yes',
  'keep-open': 'always',
  'sub-visibility': 'no',
  'input-default-bindings': 'no',
  'terminal': 'no',
  scripts: AUTO_PAUSE_LUA,
  ...extra
});

export const createPlayer = (env: NativeEnv, extra: Record<string, string> = {}): Promise<Libmpv> =>
  Libmpv.create(env.addon, {options: headlessOptions(extra), apiVersion: env.apiVersion});

/** Records every event of a player so tests can wait for and inspect them. */
export class EventLog {
  readonly events: LibmpvEvent[] = [];

  constructor(player: Libmpv) {
    player.on('event', (event: LibmpvEvent) => this.events.push(event));
  }

  clear(): void {
    this.events.length = 0;
  }

  names(): string[] {
    return this.events.map(e => e.event);
  }

  /** Values of one observed property, in arrival order. */
  values(property: string): unknown[] {
    return this.events
      .filter((e): e is Extract<LibmpvEvent, { event: 'property-change' }> => e.event === 'property-change' && e.name === property)
      .map(e => e.data);
  }

  has(eventName: string): boolean {
    return this.events.some(e => e.event === eventName);
  }

  wait(predicate: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
    return waitFor(predicate, timeoutMs, what);
  }
}

export const fixturesExist = (): boolean => fs.existsSync(SAMPLE_MP4) && fs.existsSync(AUTO_PAUSE_LUA);
