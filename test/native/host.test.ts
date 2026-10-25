import {execFileSync} from 'child_process';
import {afterEach, describe, expect, it} from 'vitest';
import {Libmpv, LibmpvEvent, RenderFrame} from '../../libmpv-bridge';
import {createPlayer, describeNative, EventLog, SAMPLE_MP4, sleep, waitFor} from './support/native';

// The out-of-process libmpv host exists on Linux only.
const hostPids = (): number[] => {
  try {
    return execFileSync('pgrep', ['-x', 'yall-mpv-host'], {encoding: 'utf8'}).split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
};

if (process.platform === 'linux') {
  describeNative('libmpv host process', (env) => {
    const players: Libmpv[] = [];

    afterEach(async () => {
      await Promise.all(players.splice(0).map(p => p.destroy()));
    });

    const open = async (): Promise<{ player: Libmpv; log: EventLog }> => {
      const player = await createPlayer(env);
      players.push(player);
      const log = new EventLog(player);
      await player.command(['loadfile', SAMPLE_MP4, 'replace']);
      await log.wait(() => log.has('playback-restart'), 'playback-restart');
      return {player, log};
    };

    it('runs one host process per core and leaves none behind after destroy', async () => {
      const before = hostPids().length;
      const first = await open();
      const second = await open();
      expect(hostPids().length).toBe(before + 2);
      expect(env.addon.liveCounts().cores).toBe(2);
      await first.player.destroy();
      await second.player.destroy();
      expect(hostPids().length).toBe(before);
      expect(env.addon.liveCounts().cores).toBe(0);
    });

    it('does not leave host processes behind across 20 cycles', async () => {
      const before = hostPids().length;
      for (let i = 0; i < 20; i++) {
        const {player} = await open();
        await player.setProperty('pause', false);
        await sleep(20);
        await player.destroy();
      }
      expect(hostPids().length).toBe(before);
    });

    it('turns a crashed host into HOST_CRASHED and a shutdown event', async () => {
      const {player, log} = await open();
      const events: LibmpvEvent[] = [];
      player.on('event', (e: LibmpvEvent) => events.push(e));
      const [pid] = hostPids().slice(-1);
      expect(pid).toBeGreaterThan(0);
      const pending = player.getProperty('volume').then(() => 'resolved', (e: { code: string }) => e.code);
      process.kill(pid, 'SIGKILL');
      expect(await pending).toBe('HOST_CRASHED');
      await waitFor(() => log.has('shutdown'), 5000, 'the shutdown event');
      expect(events.some(e => e.event === 'log-message' && e.level === 'fatal')).toBe(true);
      await expect(player.command(['stop'])).rejects.toMatchObject({code: 'HOST_CRASHED'});
      await player.destroy();
      expect(env.addon.liveCounts().cores).toBe(0);
    });

    it('keeps delivering frames while the client acknowledges them', async () => {
      const player = await createPlayer(env, {vo: 'libmpv', pause: 'no', hwdec: 'no', 'loop-file': 'inf'});
      players.push(player);
      let received = 0;
      await player.attachRenderer({backend: 'readback', width: 320, height: 180}, (frame) => {
        received++;
        expect(frame.pixels!.length).toBe(frame.width * frame.height * 4);
      });
      await player.command(['loadfile', SAMPLE_MP4, 'replace']);
      await waitFor(() => received >= 30, 15000, '30 frames');
      // The host skips frames while the client has not acknowledged two of them; it must never stall.
      const mark = received;
      await sleep(500);
      expect(received).toBeGreaterThan(mark);
    });

    // Needs a DRM node whose GBM/EGL can allocate buffers. Machines without one (CI, WSL without /dev/dri access)
    // must get a truthful error that names the reason, which is what the frame sender falls back on.
    it('attaches dmabuf-shared and delivers dma-bufs per slot, or refuses with a reason', async () => {
      const player = await createPlayer(env, {vo: 'libmpv', pause: 'no', hwdec: 'no', 'loop-file': 'inf'});
      players.push(player);
      const frames: RenderFrame[] = [];
      let attach;
      try {
        attach = await player.attachRenderer({backend: 'dmabuf-shared', width: 320, height: 180}, (frame) => {
          frames.push(frame);
          player.releaseSlot(frame.attachId, frame.slotId, frame.serial);
        });
      } catch (error) {
        const {code, message} = error as { code: string; message: string };
        console.log(`dmabuf-shared refused: ${code}: ${message}`);
        expect(['RENDER_INIT_FAILED', 'BACKEND_UNSUPPORTED']).toContain(code);
        expect(message.length).toBeGreaterThan(10);
        expect(env.addon.liveCounts().slots).toBe(0);
        // A refused attach leaves the core usable: readback still works on it.
        let pixels = 0;
        await player.attachRenderer({backend: 'readback', width: 160, height: 90}, () => pixels++);
        await player.command(['loadfile', SAMPLE_MP4, 'replace']);
        await waitFor(() => pixels > 0, 15000, 'a readback frame after the refusal');
        return;
      }
      expect(attach).toMatchObject({backend: 'dmabuf-shared', impl: 'gl', gpuWaitImpl: 'finish'});
      expect(attach.adapter.name.length).toBeGreaterThan(0);
      await player.command(['loadfile', SAMPLE_MP4, 'replace']);
      await waitFor(() => frames.length >= 10, 15000, '10 shared frames');
      for (const frame of frames) {
        expect(frame.pixels).toBeUndefined();
        expect(frame.dmabuf!.fd).toBeGreaterThanOrEqual(0);
        expect(frame.dmabuf!.stride).toBeGreaterThanOrEqual(frame.width * 4);
        expect(frame.dmabuf!.size).toBeGreaterThanOrEqual(frame.dmabuf!.stride * frame.height);
        expect(frame.dmabuf!.modifier).toMatch(/^[0-9]+$/);
      }
      // The first frames carry five BGRA probe samples (20 bytes); the sample video has a picture in them.
      expect(frames[0].probe).toHaveLength(20);
      expect(frames[0].probe!.every(v => v >= 0 && v <= 255)).toBe(true);
      expect(frames.slice(0, 10).some(f => f.probe?.some((v, i) => i % 4 !== 3 && v > 0))).toBe(true);
      const first = frames[0];
      expect(new Set(frames.map(f => f.slotId)).size).toBeLessThanOrEqual(4);

      // A resize replaces the buffers: new generation, new size, and the stats stay clean.
      player.resize(400, 225);
      await waitFor(() => frames.some(f => f.generation > first.generation && f.width === 400), 15000, 'a frame at the new size');
      await waitFor(() => player.stats()?.rendered !== undefined && player.stats()!.rendered > 10, 5000, 'stats');
      const stats = player.stats()!;
      expect(stats.backend).toBe('dmabuf-shared');
      expect(stats.glErrors ?? 0).toBe(0);
      expect(stats.note).toContain('/dev/dri/');
      expect(env.addon.liveCounts().slots).toBe(0); // slots live in the host process, not in this one
    });
  });
} else {
  describe.skip('libmpv host process (Linux only)', () => undefined);
}
