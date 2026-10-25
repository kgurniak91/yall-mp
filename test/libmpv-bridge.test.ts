import * as path from 'path';
import {describe, expect, it, vi} from 'vitest';
import {
  addonCandidates,
  computeReadbackSize,
  Libmpv,
  LibmpvError,
  libmpvCandidates,
  loadLibmpv,
  loadLibmpvAddon,
  NativeAddon,
  NativeMpvCore,
  toUnpackedPath
} from '../libmpv-bridge';

const fakeCore = (overrides: Partial<NativeMpvCore> = {}): NativeMpvCore => ({
  setOption: vi.fn(),
  initialize: vi.fn(),
  onEvent: vi.fn(),
  command: vi.fn().mockResolvedValue(undefined),
  getProperty: vi.fn().mockResolvedValue(1),
  setProperty: vi.fn().mockResolvedValue(undefined),
  observeProperty: vi.fn().mockReturnValue(1),
  unobserveProperty: vi.fn(),
  requestLogMessages: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
  attachRenderer: vi.fn(),
  resize: vi.fn(),
  releaseSlot: vi.fn(),
  detachRenderer: vi.fn(),
  stats: vi.fn().mockReturnValue(null),
  ...overrides
});

const fakeAddon = (core: NativeMpvCore, loadLibrary?: NativeAddon['loadLibrary']): NativeAddon => ({
  loadLibrary: loadLibrary ?? vi.fn().mockReturnValue({path: 'x', apiVersion: [2, 6]}),
  apiVersion: vi.fn().mockReturnValue(null),
  liveCounts: vi.fn(),
  MpvCore: function () {
    return core;
  } as unknown as NativeAddon['MpvCore']
});

describe('libmpv-bridge', () => {
  describe('libmpvCandidates', () => {
    it('puts a custom path first on every platform', () => {
      for (const platform of ['win32', 'darwin', 'linux'] as const) {
        expect(libmpvCandidates({platform, basePath: '/base', customPath: '/custom/mpv'})[0]).toBe('/custom/mpv');
      }
    });

    it('uses the bundled dll on Windows', () => {
      expect(libmpvCandidates({platform: 'win32', basePath: '/base'}))
        .toEqual([path.join('/base', 'electron-resources', 'windows', 'libmpv-2.dll')]);
    });

    it('searches Homebrew locations on macOS', () => {
      expect(libmpvCandidates({platform: 'darwin', basePath: '/base'})).toEqual([
        '/opt/homebrew/lib/libmpv.2.dylib', '/usr/local/lib/libmpv.2.dylib', 'libmpv.2.dylib', 'libmpv.dylib'
      ]);
    });

    it('uses the system library on Linux', () => {
      expect(libmpvCandidates({platform: 'linux', basePath: '/base'})).toEqual(['libmpv.so.2', 'libmpv.so']);
    });
  });

  describe('addonCandidates', () => {
    it('orders env, explicit path, build output and prebuild', () => {
      const root = path.join('/app');
      const list = addonCandidates({
        env: {YALL_LIBMPV_ADDON: '/env/a.node'}, explicitPath: '/explicit/b.node', appRoot: root, platform: 'win32', arch: 'x64'
      });
      expect(list).toEqual([
        '/env/a.node',
        '/explicit/b.node',
        path.join(root, 'native', 'yall-libmpv', 'build', 'Release', 'yall_libmpv.node'),
        path.join(root, 'native', 'yall-libmpv', 'prebuilds', 'win32-x64', 'yall_libmpv.node')
      ]);
    });

    it('rewrites app.asar to app.asar.unpacked once', () => {
      expect(toUnpackedPath('C:\\res\\app.asar\\native\\a.node')).toBe('C:\\res\\app.asar.unpacked\\native\\a.node');
      expect(toUnpackedPath('/res/app.asar/native/a.node')).toBe('/res/app.asar.unpacked/native/a.node');
      expect(toUnpackedPath('/res/app.asar.unpacked/native/a.node')).toBe('/res/app.asar.unpacked/native/a.node');
    });
  });

  describe('loadLibmpvAddon', () => {
    it('reports every tried path when nothing loads', () => {
      const dlopen = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        loadLibmpvAddon({addonPath: '/x/a.node', appRoot: '/app', dlopen});
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(LibmpvError);
        expect((error as LibmpvError).code).toBe('ADDON_NOT_FOUND');
        expect((error as LibmpvError).tried.length).toBeGreaterThanOrEqual(3);
        expect((error as LibmpvError).message).toContain('boom');
      }
    });

    it('reports the missing host on Linux instead of looking for an addon', () => {
      try {
        loadLibmpvAddon({platform: 'linux', hostPath: '/nope/yall-mpv-host', appRoot: '/nope', resourcesPath: '/nope/res'});
        expect.unreachable();
      } catch (error) {
        expect((error as LibmpvError).code).toBe('ADDON_NOT_FOUND');
        expect((error as LibmpvError).message).toContain('yall-mpv-host');
        expect((error as LibmpvError).tried.map(t => t.path)).toContain('/nope/yall-mpv-host');
      }
    });

    it('returns the exports of the first candidate that loads', () => {
      const addon = {marker: true};
      const dlopen = vi.fn().mockImplementation((module: { exports: unknown }, file: string) => {
        if (file !== '/x/a.node') {
          throw new Error('no');
        }
        module.exports = addon;
      });
      expect(loadLibmpvAddon({addonPath: '/x/a.node', appRoot: '/app', dlopen})).toBe(addon);
    });
  });

  describe('loadLibmpv', () => {
    it('returns the first library that loads and keeps trying after failures', () => {
      const loadLibrary = vi.fn()
        .mockImplementationOnce(() => {
          throw new Error('Could not load a');
        })
        .mockReturnValueOnce({path: 'b', apiVersion: [2, 6]});
      expect(loadLibmpv(fakeAddon(fakeCore(), loadLibrary), ['a', 'b'])).toEqual({path: 'b', apiVersion: [2, 6]});
    });

    it('throws LIB_NOT_FOUND with the tried list', () => {
      const loadLibrary = vi.fn().mockImplementation((p: string) => {
        throw new Error(`cannot open ${p}`);
      });
      try {
        loadLibmpv(fakeAddon(fakeCore(), loadLibrary), ['a', 'b']);
        expect.unreachable();
      } catch (error) {
        const e = error as LibmpvError;
        expect(e.code).toBe('LIB_NOT_FOUND');
        expect(e.tried).toEqual([{path: 'a', error: 'cannot open a'}, {path: 'b', error: 'cannot open b'}]);
        expect(e.message).toContain('cannot open b');
      }
    });

    it('throws LIB_TOO_OLD for a client API below 2.0', () => {
      const loadLibrary = vi.fn().mockReturnValue({path: 'old', apiVersion: [1, 109]});
      expect(() => loadLibmpv(fakeAddon(fakeCore(), loadLibrary), ['old'])).toThrowError(/client API 1\.109/);
    });

    it('does not mask a library that conflicts with the one already loaded', () => {
      const loadLibrary = vi.fn().mockImplementation(() => {
        throw Object.assign(new Error('already loaded from X'), {code: 'LIB_ALREADY_LOADED'});
      });
      try {
        loadLibmpv(fakeAddon(fakeCore(), loadLibrary), ['a']);
        expect.unreachable();
      } catch (error) {
        expect((error as LibmpvError).code).toBe('INIT_FAILED');
      }
    });
  });

  describe('Libmpv', () => {
    it('sets options, initializes and forwards events under their own name', async () => {
      let listener: (event: unknown) => void = () => undefined;
      const core = fakeCore({onEvent: vi.fn().mockImplementation((l) => listener = l)});
      const libmpv = await Libmpv.create(fakeAddon(core), {options: {vo: 'null', ao: 'null'}, apiVersion: [2, 6]});
      expect(core.setOption).toHaveBeenCalledWith('vo', 'null');
      expect(core.setOption).toHaveBeenCalledWith('ao', 'null');
      expect(core.initialize).toHaveBeenCalledTimes(1);

      const raw = vi.fn();
      const seek = vi.fn();
      libmpv.on('event', raw);
      libmpv.on('seek', seek);
      listener({event: 'seek'});
      expect(raw).toHaveBeenCalledWith({event: 'seek'});
      expect(seek).toHaveBeenCalledTimes(1);
    });

    it('wraps a failing initialize in INIT_FAILED and destroys the core', async () => {
      const core = fakeCore({
        initialize: vi.fn().mockImplementation(() => {
          throw new Error('invalid parameter');
        })
      });
      try {
        await Libmpv.create(fakeAddon(core), {options: {}, apiVersion: [2, 6]});
        expect.unreachable();
      } catch (error) {
        expect((error as LibmpvError).code).toBe('INIT_FAILED');
        expect((error as LibmpvError).message).toContain('invalid parameter');
      }
      expect(core.destroy).toHaveBeenCalled();
    });

    it('supports D3D11 only on Windows with client API 2.6+', async () => {
      const make = async (platform: NodeJS.Platform, apiVersion: [number, number]) =>
        (await Libmpv.create(fakeAddon(fakeCore()), {options: {}, apiVersion, platform})).supportsD3D11();
      expect(await make('win32', [2, 6])).toBe(true);
      expect(await make('win32', [2, 5])).toBe(false);
      expect(await make('linux', [2, 6])).toBe(false);
      expect(await make('darwin', [2, 9])).toBe(false);
    });

    it('waits for an asynchronous initialize (the Linux host)', async () => {
      let release: () => void = () => undefined;
      const core = fakeCore({initialize: vi.fn().mockReturnValue(new Promise<void>(resolve => release = resolve))});
      let created = false;
      const pending = Libmpv.create(fakeAddon(core), {options: {}, apiVersion: [2, 6]}).then(() => created = true);
      await Promise.resolve();
      expect(created).toBe(false);
      release();
      await pending;
      expect(created).toBe(true);
    });

    it('destroys the core once', async () => {
      const core = fakeCore();
      const libmpv = await Libmpv.create(fakeAddon(core), {options: {}, apiVersion: [2, 6]});
      await libmpv.destroy();
      await libmpv.destroy();
      expect(core.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('computeReadbackSize', () => {
    const cases: Array<[string, Parameters<typeof computeReadbackSize>[0], { width: number; height: number }]> = [
      ['canvas below the cap is kept', {canvas: {width: 800, height: 450}, software: false}, {width: 800, height: 450}],
      ['large canvas is capped at 1280x720', {canvas: {width: 1600, height: 900}, software: false}, {width: 1280, height: 720}],
      ['HiDPI canvas keeps its aspect', {canvas: {width: 3200, height: 1800}, software: false}, {width: 1280, height: 720}],
      ['software cap is 960x540', {canvas: {width: 1600, height: 900}, software: true}, {width: 960, height: 540}],
      ['video native size limits the frame', {canvas: {width: 1600, height: 900}, video: {width: 640, height: 360}, software: false}, {width: 640, height: 360}],
      ['video larger than the canvas does not enlarge it', {canvas: {width: 800, height: 450}, video: {width: 1920, height: 1080}, software: false}, {width: 800, height: 450}],
      ['odd sizes become even', {canvas: {width: 801, height: 451}, software: false}, {width: 800, height: 450}],
      ['never below 2x2', {canvas: {width: 1, height: 1}, software: false}, {width: 2, height: 2}],
      ['tall canvas is limited by the height cap', {canvas: {width: 900, height: 1600}, software: false}, {width: 404, height: 720}]
    ];

    it.each(cases)('%s', (_name, input, expected) => {
      expect(computeReadbackSize(input)).toEqual(expected);
    });
  });
});
