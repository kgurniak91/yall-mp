import {execFileSync} from 'child_process';
import {afterEach, describe, expect, it} from 'vitest';
import {Libmpv, LibmpvEvent} from '../../libmpv-bridge';
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
      player.attachRenderer({backend: 'readback', width: 320, height: 180}, (frame) => {
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
  });
} else {
  describe.skip('libmpv host process (Linux only)', () => undefined);
}
