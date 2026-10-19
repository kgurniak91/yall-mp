import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {AttachRendererOptions, Libmpv, RenderFrame} from '../../libmpv-bridge';
import {describeNative, EventLog, NativeEnv, SAMPLE_MP4, sleep, waitFor} from './support/native';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {ensureClip} = require('./support/bench-media.js') as { ensureClip: (o?: object) => string };

const isWindows = process.platform === 'win32';

interface Rig {
  player: Libmpv;
  log: EventLog;
  frames: RenderFrame[];
  attachId: number;
  /** Releases a shared frame (what the frame sender does when Chromium lets go of the texture). */
  release: (frame: RenderFrame) => void;
}

describeNative('libmpv render API', (env: NativeEnv) => {
  const players: Libmpv[] = [];

  afterEach(async () => {
    await Promise.all(players.splice(0).map(p => p.destroy()));
  });

  afterAll(async () => {
    // Everything must be gone once the players are destroyed: no leaked slots, threads or contexts.
    await waitFor(() => {
      const c = env.addon.liveCounts();
      return c.cores === 0 && c.eventThreads === 0 && c.renderers === 0 && c.renderThreads === 0 && c.slots === 0;
    }, 15000, 'all native objects to be freed');
  });

  const open = async (
    attach: Omit<AttachRendererOptions, 'width' | 'height'> & { width?: number; height?: number },
    options: { autoRelease?: boolean; file?: string; extra?: Record<string, string> } = {}
  ): Promise<Rig> => {
    const player = Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'no', 'keep-open': 'always', 'loop-file': 'inf', hwdec: 'no',
        'terminal': 'no', 'input-default-bindings': 'no', 'sub-visibility': 'no', ...options.extra
      },
      apiVersion: env.apiVersion
    });
    players.push(player);
    const log = new EventLog(player);
    player.observeProperty('time-pos');
    const frames: RenderFrame[] = [];
    const autoRelease = options.autoRelease ?? true;
    const rig: Rig = {
      player, log, frames, attachId: 0,
      release: (frame) => player.releaseSlot(frame.attachId, frame.slotId, frame.serial)
    };
    const result = player.attachRenderer({width: 320, height: 180, ...attach}, (frame) => {
      frames.push(frame);
      if (frame.handle && autoRelease) rig.release(frame);
      if (frames.length > 300) frames.splice(0, frames.length - 300);
    });
    rig.attachId = result.attachId;
    await player.command(['loadfile', options.file ?? SAMPLE_MP4, 'replace']);
    return rig;
  };

  const timePos = (rig: Rig): number => {
    const values = rig.log.values('time-pos').filter(v => typeof v === 'number') as number[];
    return values.length ? values[values.length - 1] : -1;
  };

  /** Centre pixel of a BGRA frame. */
  const centre = (frame: RenderFrame): { r: number; g: number; b: number; a: number } => {
    const px = frame.pixels!;
    const o = ((Math.floor(frame.height / 2)) * frame.width + Math.floor(frame.width / 2)) * 4;
    return {b: px[o], g: px[o + 1], r: px[o + 2], a: px[o + 3]};
  };

  const waitForColour = async (rig: Rig, from: number, to: number, check: (c: ReturnType<typeof centre>) => boolean, what: string) => {
    await waitFor(() => timePos(rig) >= from && timePos(rig) < to, 15000, `${what}: time-pos in [${from}, ${to})`);
    await waitFor(() => {
      const t = timePos(rig);
      const frame = rig.frames[rig.frames.length - 1];
      return t >= from + 0.2 && t < to && !!frame?.pixels && check(centre(frame));
    }, 8000, `${what}: centre pixel`);
  };

  const isRed = (c: ReturnType<typeof centre>) => c.r > 200 && c.g < 60 && c.b < 60 && c.a === 255;
  // ffmpeg's "green" is (0, 128, 0).
  const isGreen = (c: ReturnType<typeof centre>) => c.g > 90 && c.r < 60 && c.b < 60 && c.a === 255;

  const readbackVariants: Array<{ name: string; options: Partial<AttachRendererOptions> }> = [
    {name: 'sw', options: {impl: 'sw'}}
  ];
  if (isWindows) {
    readbackVariants.push({name: 'd3d11 on WARP', options: {impl: 'd3d11', adapter: 'warp'}});
  }

  describe.each(readbackVariants)('readback ($name)', ({options}) => {
    it('delivers BGRA frames at the requested size with the right colours', async () => {
      const rig = await open({backend: 'readback', ...options});
      await waitForColour(rig, 0.8, 2.6, isRed, 'red segment');
      const frame = rig.frames[rig.frames.length - 1];
      expect(frame.width).toBe(320);
      expect(frame.height).toBe(180);
      expect(frame.pixels!.length).toBe(320 * 180 * 4);
      expect(frame.handle).toBeUndefined();

      await rig.player.command(['seek', '4', 'absolute+exact']);
      await waitForColour(rig, 3.8, 5.6, isGreen, 'green segment');
    });

    it('redraws at the new size, also while paused', async () => {
      const rig = await open({backend: 'readback', ...options});
      await waitFor(() => rig.frames.length > 3, 10000, 'first frames');
      await rig.player.setProperty('pause', true);
      await sleep(300);
      rig.frames.length = 0;
      rig.player.resize(200, 120);
      await waitFor(() => rig.frames.some(f => f.width === 200 && f.height === 120), 5000, 'a 200x120 frame');
      expect(rig.player.stats()!.generation).toBeGreaterThan(1);
    });

    it('reports its stats', async () => {
      const rig = await open({backend: 'readback', ...options});
      await waitFor(() => rig.frames.length > 10, 10000, 'frames');
      const stats = rig.player.stats()!;
      expect(stats.backend).toBe('readback');
      expect(stats.rendered).toBeGreaterThan(10);
      expect(stats.renderMs.p50).toBeGreaterThan(0);
      expect(stats.postFailures).toBe(0);
    });
  });

  it('detaches a readback renderer and can attach a new one on the same core', async () => {
    const rig = await open({backend: 'readback', impl: 'sw'});
    await waitFor(() => rig.frames.length > 3, 10000, 'first frames');
    const second: RenderFrame[] = [];
    const again = rig.player.attachRenderer({backend: 'readback', impl: 'sw', width: 160, height: 90}, f => second.push(f));
    expect(again.attachId).not.toBe(rig.attachId);
    // Freeing the first render context took mpv's video output with it.
    await rig.player.reinitVideo();
    await waitFor(() => second.some(f => f.width === 160), 10000, 'frames of the second attach');
    rig.player.detachRenderer();
    expect(rig.player.stats()).toBeNull();
  });

  describe.runIf(isWindows).each([{adapter: 'warp' as const}, {adapter: 'default' as const}])('d3d11-shared ($adapter)', ({adapter}) => {
    it('hands out shared NT handles and waits for the GPU without spinning', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter});
      await waitFor(() => rig.frames.length > 10, 15000, 'shared frames');
      const frame = rig.frames[rig.frames.length - 1];
      expect(frame.handle!.length).toBe(8);
      expect(frame.handle!.readBigUInt64LE()).not.toBe(0n);
      expect(frame.pixels).toBeUndefined();
      const stats = rig.player.stats()!;
      expect(stats.backend).toBe('d3d11-shared');
      expect(stats.impl).toBe('d3d11');
      expect(stats.gpuWaitImpl).not.toBe('query-poll');
      expect(stats.gpuWaitTimeouts).toBe(0);
      // 'default' may itself resolve to WARP on a GPU-less machine (CI), so only the explicit WARP case is certain
      if (adapter === 'warp') {
        expect(stats.adapter.software).toBe(true);
      }
    });

    it('detaches with all slots in flight, accepts late releases and drains', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter, slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => rig.player.stats()!.inFlight === 4, 15000, 'a full pool');
      const held = rig.frames.slice(0, 4);
      rig.player.detachRenderer();

      // The render thread frees the context first and then waits for the slots.
      await waitFor(() => env.addon.liveCounts().renderers === 0, 10000, 'the render context to be freed');
      expect(env.addon.liveCounts().renderThreads).toBe(1);
      expect(env.addon.liveCounts().slots).toBe(4);

      for (const frame of held) rig.release(frame);
      await waitFor(() => env.addon.liveCounts().renderThreads === 0, 10000, 'the drain to end');
      expect(env.addon.liveCounts().slots).toBe(0);
    });
  });

  describe.runIf(isWindows)('d3d11-shared pool (WARP)', () => {
    it('holds exactly 4 in flight, then skips frames until a slot is released', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter: 'warp', slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => (rig.player.stats()?.exhausted ?? 0) > 3, 15000, 'pool exhaustion');
      let stats = rig.player.stats()!;
      expect(stats.inFlight).toBe(4);
      expect(stats.poolSize).toBe(4);
      expect(rig.frames).toHaveLength(4);

      rig.release(rig.frames[0]);
      await waitFor(() => rig.frames.length > 4, 10000, 'frames to resume after a release');
      stats = rig.player.stats()!;
      expect(stats.released).toBeGreaterThanOrEqual(1);
    });

    it('reclaims slots that are never released after the timeout and keeps delivering', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter: 'warp', slotTimeoutMs: 300}, {autoRelease: false});
      await waitFor(() => (rig.player.stats()?.reclaimed ?? 0) >= 4, 15000, 'reclaimed slots');
      await waitFor(() => rig.frames.length > 8, 15000, 'frames after reclaim');
      expect(rig.player.stats()!.inFlight).toBeLessThanOrEqual(4);
    });

    it('ignores a release with a stale serial', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter: 'warp', slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => rig.frames.length >= 2, 15000, 'frames');
      const frame = rig.frames[0];
      await rig.player.setProperty('pause', true);
      await sleep(300);
      const before = rig.player.stats()!;
      rig.player.releaseSlot(frame.attachId, frame.slotId, frame.serial + 99);
      await sleep(100);
      const after = rig.player.stats()!;
      expect(after.lateReleases).toBe(before.lateReleases + 1);
      expect(after.inFlight).toBe(before.inFlight);
    });

    it('resizes: the generation bumps and new frames have the new size, also while paused', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter: 'warp'});
      await waitFor(() => rig.frames.length > 3, 15000, 'frames');
      const generation = rig.player.stats()!.generation;
      await rig.player.setProperty('pause', true);
      await sleep(300);
      rig.player.resize(400, 224);
      await waitFor(() => rig.frames.some(f => f.width === 400 && f.height === 224), 5000, 'a 400x224 frame');
      expect(rig.player.stats()!.generation).toBeGreaterThan(generation);
      const newest = rig.frames.filter(f => f.width === 400).pop()!;
      expect(newest.generation).toBeGreaterThan(rig.frames[0].generation);
    });
  });

  // The capped readback must stay interactive on a machine without a GPU.
  describe.runIf(isWindows)('WARP readback throughput', () => {
    it('reaches 24 fps at 960x540 from a 1080p30 clip', async () => {
      const clip = ensureClip({size: '1920x1080', fps: 30, seconds: 20});
      const rig = await open({backend: 'readback', impl: 'd3d11', adapter: 'warp', width: 960, height: 540}, {file: clip});
      await waitFor(() => rig.frames.length > 5, 30000, 'the first frames');
      const startCount = rig.player.stats()!.rendered;
      const start = Date.now();
      await sleep(5000);
      const stats = rig.player.stats()!;
      const fps = (stats.rendered - startCount) / ((Date.now() - start) / 1000);
      console.log(`WARP readback 960x540 from 1080p30: ${fps.toFixed(1)} fps, dropped ${stats.readbackDropped}, ` +
        `render p50 ${stats.renderMs.p50.toFixed(1)} ms, copy p50 ${stats.copyMs.p50.toFixed(1)} ms`);
      if (process.env['YALL_NATIVE_PERF'] === '1') {
        expect(fps).toBeGreaterThanOrEqual(24);
      }
    });
  });
});
