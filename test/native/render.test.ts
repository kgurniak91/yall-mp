import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {AttachRendererOptions, Libmpv, RenderFrame} from '../../libmpv-bridge';
import {describeNative, EventLog, NativeEnv, SAMPLE_MP4, sleep, waitFor} from './support/native';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {ensureClip, ensureSplitClip} = require('./support/bench-media.js') as {
  ensureClip: (o?: object) => string; ensureSplitClip: (o?: object) => string;
};

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

type Pixel = { r: number; g: number; b: number; a: number };

interface Rig {
  player: Libmpv;
  log: EventLog;
  frames: RenderFrame[];
  /** iosurface-shared: the pixels read inside the frame callback (see `sample`), keyed by frame. */
  samples: WeakMap<RenderFrame, Array<Pixel | null>>;
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
    options: { autoRelease?: boolean; file?: string; extra?: Record<string, string>; sample?: Array<[number, number]> } = {}
  ): Promise<Rig> => {
    const player = await Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'no', 'keep-open': 'always', 'loop-file': 'inf', hwdec: 'no',
        'terminal': 'no', 'input-default-bindings': 'no', 'sub-visibility': 'no',
        // Apple's software OpenGL renderer (hosted CI) needs 30+ ms per frame with mpv's default scalers
        ...(attach.backend === 'iosurface-shared' ? {profile: 'fast'} : {}), ...options.extra
      },
      apiVersion: env.apiVersion
    });
    players.push(player);
    const log = new EventLog(player);
    player.observeProperty('time-pos');
    const frames: RenderFrame[] = [];
    const autoRelease = options.autoRelease ?? true;
    const rig: Rig = {
      player, log, frames, samples: new WeakMap(), attachId: 0,
      release: (frame) => player.releaseSlot(frame.attachId, frame.slotId, frame.serial)
    };
    const result = await player.attachRenderer({width: 320, height: 180, ...attach}, (frame) => {
      // A frame is only safe to read until it is released: the next render reuses the slot.
      if (frame.handle && options.sample && env.addon.readSurfacePixel) {
        rig.samples.set(frame, options.sample.map(([x, y]) => env.addon.readSurfacePixel!(frame.handle!, x, y)));
      }
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
  const isBlue = (c: ReturnType<typeof centre>) => c.b > 200 && c.r < 60 && c.g < 60 && c.a === 255;
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
      // the render thread stamps every frame with the wall clock, for the latency statistics
      expect(Math.abs(Date.now() - frame.renderedAt!)).toBeLessThan(5000);

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
      // The Linux host answers stats() from its last snapshot, so wait for the new generation to show up.
      await waitFor(() => (rig.player.stats()?.generation ?? 0) > 1, 5000, 'the new generation in the stats');
    });

    it('draws the picture again on request, also while paused', async () => {
      const rig = await open({backend: 'readback', ...options});
      await waitFor(() => rig.frames.length > 3, 10000, 'first frames');
      await rig.player.setProperty('pause', true);
      await sleep(400);
      rig.frames.length = 0;
      await sleep(300);
      expect(rig.frames).toHaveLength(0);
      expect(rig.player.redraw()).toBe(true);
      await waitFor(() => rig.frames.length >= 1, 5000, 'a frame after redraw');
      expect(rig.frames[0].width).toBe(320);
    });

    it('reports its stats', async () => {
      const rig = await open({backend: 'readback', ...options});
      await waitFor(() => rig.frames.length > 10, 10000, 'frames');
      await waitFor(() => (rig.player.stats()?.rendered ?? 0) > 10, 5000, 'rendered frames in the stats');
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
    const again = await rig.player.attachRenderer({backend: 'readback', impl: 'sw', width: 160, height: 90}, f => second.push(f));
    expect(again.attachId).not.toBe(rig.attachId);
    // Freeing the first render context took mpv's video output with it.
    await rig.player.reinitVideo();
    await waitFor(() => second.some(f => f.width === 160), 10000, 'frames of the second attach');
    rig.player.detachRenderer();
    expect(rig.player.stats()).toBeNull();
  });

  it('frees the render backends of a destroyed core without waiting for the wrapper to be collected', async () => {
    // The pixel pool of a 1600x900 software backend holds ~23 MB; a core that is destroyed and dropped must not keep it.
    const rss = (): number => process.memoryUsage().rss / 1048576;
    const cycle = async (): Promise<void> => {
      const rig = await open({backend: 'readback', impl: 'sw', width: 1600, height: 900});
      await waitFor(() => rig.frames.length > 5, 10000, 'frames');
      await players.splice(players.indexOf(rig.player), 1)[0].destroy();
    };
    await cycle(); // allocator and library warm-up
    const before = rss();
    for (let i = 0; i < 5; i++) await cycle();
    // The hosted macOS runner's resident size is noisy (it reads 40-45 MB with nothing leaking)
    expect(rss() - before).toBeLessThan(isMac ? 80 : 40);
  }, 60000);

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

    it('probes five points of the first frames, not of later ones', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter});
      await waitFor(() => rig.frames.length > 45, 15000, 'shared frames');
      const probed = rig.frames.filter(f => f.probe);
      expect(probed.length).toBe(30);
      expect(rig.frames.slice(0, 30).every(f => f.probe?.length === 20)).toBe(true);
      expect(rig.frames.slice(30).some(f => f.probe)).toBe(false);
      // BGRA: the sample opens on red, so some probed frame has a lit red channel (index 2) at the centre
      expect(probed.some(f => f.probe![2] > 200 && f.probe![0] < 60 && f.probe![1] < 60)).toBe(true);
    });

    it('draws the picture again on request, also while paused', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter});
      await waitFor(() => rig.frames.length > 5, 15000, 'shared frames');
      await rig.player.setProperty('pause', true);
      await sleep(400);
      rig.frames.length = 0;
      await sleep(300);
      expect(rig.frames).toHaveLength(0);
      expect(rig.player.redraw()).toBe(true);
      await waitFor(() => rig.frames.length >= 1, 5000, 'a frame after redraw');
      expect(rig.frames[0].handle).toBeDefined();
    });

    it('detaches with all slots in flight, accepts late releases and drains', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter, slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => rig.player.stats()!.inFlight === 4, 15000, 'a full pool');
      const held = rig.frames.slice(0, 4);
      rig.player.detachRenderer();

      // The render thread frees the context first and then waits for the slots.
      await waitFor(() => env.addon.liveCounts().renderers === 0, 30000, 'the render context to be freed');
      expect(env.addon.liveCounts().renderThreads).toBe(1);
      expect(env.addon.liveCounts().slots).toBe(4);

      for (const frame of held) rig.release(frame);
      await waitFor(() => env.addon.liveCounts().renderThreads === 0, 30000, 'the drain to end');
      expect(env.addon.liveCounts().slots).toBe(0);
    }, 90000);

    it('posts one lost frame when the device is reported lost, then idles and detaches cleanly', async () => {
      const rig = await open({backend: 'd3d11-shared', adapter});
      await waitFor(() => rig.frames.length > 5, 15000, 'shared frames');
      expect(rig.player.simulateDeviceLost(rig.attachId + 1)).toBe(false);
      expect(rig.player.simulateDeviceLost(rig.attachId)).toBe(true);
      await waitFor(() => rig.frames.some(f => f.lost !== undefined), 5000, 'the lost frame');
      await sleep(400);
      const lost = rig.frames.filter(f => f.lost !== undefined);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toMatchObject({attachId: rig.attachId, slotId: -1, lost: expect.stringContaining('SIMULATED')});
      expect(lost[0].handle).toBeUndefined();
      // nothing is rendered after it
      const rendered = rig.player.stats()!.rendered;
      await sleep(400);
      expect(rig.player.stats()!.rendered).toBe(rendered);

      rig.player.detachRenderer();
      await waitFor(() => env.addon.liveCounts().renderThreads === 0, 15000, 'the drain to end');
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

  // The macOS backend needs a CGL context. Hosted CI runners may not offer one; then the attach must fail with
  // RENDER_INIT_FAILED and a reason (the frame sender turns that into the readback fallback), which the first
  // test asserts. The remaining tests need the backend and say so in the log when they are skipped.
  describe.runIf(isMac)('iosurface-shared', () => {
    let glReason: string | null = null;
    let probed = false;

    const probe = async (): Promise<void> => {
      if (probed) return;
      probed = true;
      try {
        const rig = await open({backend: 'iosurface-shared'});
        await waitFor(() => rig.frames.length > 0, 15000, 'a first iosurface frame');
        const stats = rig.player.stats()!;
        console.log(`iosurface-shared stats: ${JSON.stringify({
          backend: stats.backend, impl: stats.impl, adapter: stats.adapter, glErrors: stats.glErrors, note: stats.note,
          renderMs: stats.renderMs, gpuWaitMs: stats.gpuWaitMs
        })}`);
        await rig.player.destroy();
        players.splice(players.indexOf(rig.player), 1);
      } catch (error) {
        const e = error as Error & { code?: string };
        if (e.code !== 'RENDER_INIT_FAILED') {
          throw error;
        }
        glReason = e.message;
        console.log(`iosurface-shared unavailable on this machine (RENDER_INIT_FAILED): ${e.message}`);
      }
    };

    const needGl = async (): Promise<boolean> => {
      await probe();
      if (glReason !== null) {
        console.log(`skipping: no GL (${glReason})`);
        return false;
      }
      return true;
    };


    it('attaches, or fails with RENDER_INIT_FAILED and a reason', async () => {
      await probe();
      if (glReason !== null) {
        expect(glReason.length).toBeGreaterThan(0);
      }
      expect(typeof env.addon.readSurfacePixel).toBe('function');
    });

    // Frames are read inside the frame callback (`sample`), before the slot is released and rendered into again.
    const sampled = (rig: Rig, frame: RenderFrame, index: number): Pixel => rig.samples.get(frame)![index]!;
    const newestSampled = (rig: Rig, index: number, where: (f: RenderFrame) => boolean = () => true): Pixel | null => {
      const frame = [...rig.frames].reverse().find(f => where(f) && rig.samples.get(f)?.[index]);
      return frame ? sampled(rig, frame, index) : null;
    };

    it('hands out IOSurface handles that hold the picture the right way up', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared'}, {
        file: ensureSplitClip({width: 320, height: 180}), sample: [[160, 20], [160, 160], [0, 0], [319, 0], [0, 179], [319, 179]]
      });
      // The first frames can still be black while the file loads: wait for the picture, report what was seen.
      const isPicture = (f: RenderFrame) => !!rig.samples.get(f) && isRed(sampled(rig, f, 0)) && isBlue(sampled(rig, f, 1));
      try {
        await waitFor(() => rig.frames.some(isPicture), 15000, 'the red/blue picture');
      } catch (error) {
        const last = rig.frames[rig.frames.length - 1];
        console.log(`iosurface-shared picture never arrived: ${rig.frames.length} frames, last samples ${JSON.stringify(rig.samples.get(last))} stats ${JSON.stringify(rig.player.stats())}`);
        throw error;
      }
      const frame = rig.frames.find(isPicture)!;
      expect(frame.handle!.length).toBe(8);
      expect(frame.handle!.readBigUInt64LE()).not.toBe(0n);
      expect(frame.pixels).toBeUndefined();
      const stats = rig.player.stats()!;
      expect(stats.backend).toBe('iosurface-shared');
      expect(stats.impl).toBe('gl');
      expect(stats.gpuWaitTimeouts).toBe(0);
      console.log(`iosurface-shared samples: ${JSON.stringify(rig.samples.get(frame))} glErrors=${stats.glErrors} note=${stats.note}`);
      // every sampled frame that shows the picture has it the right way up, corners included
      const corners = rig.samples.get(frame)!.slice(2) as Pixel[];
      expect(isRed(corners[0]) && isRed(corners[1])).toBe(true);
      expect(isBlue(corners[2]) && isBlue(corners[3])).toBe(true);
      expect(stats.glErrors).toBe(0);
    });

    it('probes five points of the first frames, not of later ones', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared'});
      await waitFor(() => rig.frames.length > 45, 15000, 'shared frames');
      const probed = rig.frames.filter(f => f.probe);
      expect(probed.length).toBe(30);
      expect(rig.frames.slice(0, 30).every(f => f.probe?.length === 20)).toBe(true);
      expect(rig.frames.slice(30).some(f => f.probe)).toBe(false);
      expect(probed.some(f => f.probe![2] > 200 && f.probe![0] < 60 && f.probe![1] < 60)).toBe(true);
    });

    it('shows the colours of the sample, also after a seek', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared'}, {sample: [[160, 90]]});
      const centreIs = (check: (c: Pixel) => boolean) => {
        const c = newestSampled(rig, 0);
        return !!c && check(c);
      };
      await waitFor(() => timePos(rig) >= 1.0 && timePos(rig) < 2.4 && centreIs(isRed), 15000, 'red segment');
      await rig.player.command(['seek', '4', 'absolute+exact']);
      await waitFor(() => timePos(rig) >= 4.0 && timePos(rig) < 5.4 && centreIs(isGreen), 15000, 'green segment');
    });

    it('holds exactly 4 in flight, then skips frames until a slot is released', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared', slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => (rig.player.stats()?.exhausted ?? 0) > 3, 15000, 'pool exhaustion');
      const stats = rig.player.stats()!;
      expect(stats.inFlight).toBe(4);
      expect(stats.poolSize).toBe(4);
      expect(rig.frames).toHaveLength(4);
      rig.release(rig.frames[0]);
      await waitFor(() => rig.frames.length > 4, 10000, 'frames to resume after a release');
      expect(rig.player.stats()!.released).toBeGreaterThanOrEqual(1);
    });

    it('reclaims slots that are never released after the timeout and keeps delivering', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared', slotTimeoutMs: 300}, {autoRelease: false});
      await waitFor(() => (rig.player.stats()?.reclaimed ?? 0) >= 4, 15000, 'reclaimed slots');
      await waitFor(() => rig.frames.length > 8, 15000, 'frames after reclaim');
      expect(rig.player.stats()!.inFlight).toBeLessThanOrEqual(4);
    });

    it('ignores a release with a stale serial', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared', slotTimeoutMs: 60000}, {autoRelease: false});
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

    it('resizes: the generation bumps and new frames are new surfaces of the new size, also while paused', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared'}, {
        file: ensureSplitClip({width: 320, height: 180}), sample: [[200, 20], [200, 200], [399, 223], [400, 0]]
      });
      await waitFor(() => rig.frames.length > 3, 15000, 'frames');
      const generation = rig.player.stats()!.generation;
      await rig.player.setProperty('pause', true);
      await sleep(300);
      rig.player.resize(400, 224);
      const isNew = (f: RenderFrame) => f.width === 400 && f.height === 224;
      await waitFor(() => rig.frames.some(isNew), 5000, 'a 400x224 frame');
      expect(rig.player.stats()!.generation).toBeGreaterThan(generation);
      const newest = rig.frames.filter(isNew).pop()!;
      expect(newest.generation).toBeGreaterThan(rig.frames[0].generation);
      const samples = rig.samples.get(newest)!;
      console.log(`iosurface-shared resized frame samples: ${JSON.stringify(samples)}`);
      expect(isRed(samples[0]!)).toBe(true);
      expect(isBlue(samples[1]!)).toBe(true);
      expect(samples[2]).not.toBeNull();
      expect(samples[3]).toBeNull();
    });

    it('detaches with all slots in flight, accepts late releases and drains', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared', slotTimeoutMs: 60000}, {autoRelease: false});
      await waitFor(() => rig.player.stats()!.inFlight === 4, 15000, 'a full pool');
      const held = rig.frames.slice(0, 4);
      rig.player.detachRenderer();
      await waitFor(() => env.addon.liveCounts().renderers === 0, 30000, 'the render context to be freed');
      expect(env.addon.liveCounts().renderThreads).toBe(1);
      expect(env.addon.liveCounts().slots).toBe(4);
      console.log(`iosurface drain: held ${held.length} frames, slots ${JSON.stringify(held.map(f => [f.slotId, f.serial]))}, counts ${JSON.stringify(env.addon.liveCounts())}`);
      for (const frame of held) rig.release(frame);
      try {
        await waitFor(() => env.addon.liveCounts().renderThreads === 0, 30000, 'the drain to end');
      } catch (error) {
        throw new Error(`${(error as Error).message}; counts after the releases ${JSON.stringify(env.addon.liveCounts())}, frames seen ${rig.frames.length}`);
      }
      expect(env.addon.liveCounts().slots).toBe(0);
    }, 90000);

    it('posts one lost frame when the device is reported lost, then idles and detaches cleanly', async () => {
      if (!await needGl()) return;
      const rig = await open({backend: 'iosurface-shared'});
      await waitFor(() => rig.frames.length > 5, 15000, 'shared frames');
      expect(rig.player.simulateDeviceLost(rig.attachId + 1)).toBe(false);
      expect(rig.player.simulateDeviceLost(rig.attachId)).toBe(true);
      await waitFor(() => rig.frames.some(f => f.lost !== undefined), 5000, 'the lost frame');
      await sleep(400);
      const lost = rig.frames.filter(f => f.lost !== undefined);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toMatchObject({attachId: rig.attachId, slotId: -1, lost: expect.stringContaining('SIMULATED')});
      expect(lost[0].handle).toBeUndefined();
      // nothing is rendered after it
      const rendered = rig.player.stats()!.rendered;
      await sleep(400);
      expect(rig.player.stats()!.rendered).toBe(rendered);

      rig.player.detachRenderer();
      await waitFor(() => env.addon.liveCounts().renderThreads === 0, 15000, 'the drain to end');
      expect(env.addon.liveCounts().slots).toBe(0);
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
