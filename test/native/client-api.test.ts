import {afterEach, expect, it} from 'vitest';
import {compareApiVersion, D3D11_API_VERSION, Libmpv, LibmpvError} from '../../libmpv-bridge';
import {createPlayer, describeNative, EventLog, SAMPLE_MP4, sleep, waitFor} from './support/native';

describeNative('libmpv client API', (env) => {
  const players: Libmpv[] = [];
  const track = (player: Libmpv): Libmpv => {
    players.push(player);
    return player;
  };

  afterEach(async () => {
    await Promise.all(players.splice(0).map(p => p.destroy()));
  });

  /** Loads the sample paused and waits until it is ready, observing the usual properties. */
  const openSample = async (extra: Record<string, string> = {}) => {
    const player = track(createPlayer(env, extra));
    const log = new EventLog(player);
    for (const name of ['time-pos', 'pause', 'duration', 'eof-reached', 'user-data/auto-pause-fired']) {
      player.observeProperty(name);
    }
    await player.command(['loadfile', SAMPLE_MP4, 'replace']);
    await log.wait(() => log.has('playback-restart'), 'initial playback-restart');
    return {player, log};
  };

  it('exposes the client API version, 2.6+ for the Windows D3D11 build', () => {
    expect(compareApiVersion(env.apiVersion, [2, 0])).toBeGreaterThanOrEqual(0);
    expect(env.addon.apiVersion()).toEqual(env.apiVersion);
    if (process.platform === 'win32') {
      expect(compareApiVersion(env.apiVersion, D3D11_API_VERSION)).toBeGreaterThanOrEqual(0);
    }
  });

  it('plays: time-pos events are numbers that advance, pause is a boolean, duration is ~10', async () => {
    const {player, log} = await openSample({speed: '4'});
    expect(await player.getProperty<number>('duration')).toBeCloseTo(10, 0);
    expect(log.values('pause').every(v => typeof v === 'boolean')).toBe(true);

    await player.setProperty('pause', false);
    await log.wait(() => log.values('pause').includes(false), 'unpause');
    await log.wait(() => {
      const times = log.values('time-pos').filter(v => v !== null);
      return times.length >= 5 && (times[times.length - 1] as number) > 1;
    }, 'time-pos to pass 1 s');

    const times = log.values('time-pos').filter(v => v !== null);
    expect(times.every(v => typeof v === 'number')).toBe(true);
    expect(times[times.length - 1] as number).toBeGreaterThan(times[0] as number);
  });

  it('converts values between JS and mpv types in both directions', async () => {
    const {player} = await openSample();
    await player.setProperty('speed', 2);
    expect(await player.getProperty('speed')).toBe(2);
    await player.setProperty('speed', 1.5);
    expect(await player.getProperty('speed')).toBe(1.5);
    await player.setProperty('mute', true);
    expect(await player.getProperty('mute')).toBe(true);
    await player.setProperty('volume', 40);
    expect(await player.getProperty('volume')).toBe(40);
    await player.setProperty('force-media-title', 'ünï');
    expect(await player.getProperty('media-title')).toBe('ünï');
    expect(Array.isArray(await player.getProperty('track-list'))).toBe(true);
  });

  it('emits seek and then playback-restart after a seek', async () => {
    const {player, log} = await openSample();
    log.clear();
    await player.command(['seek', '5', 'absolute', 'exact']);
    await log.wait(() => log.has('playback-restart'), 'playback-restart after seek');
    const names = log.names().filter(n => n === 'seek' || n === 'playback-restart');
    expect(names).toEqual(['seek', 'playback-restart']);
    expect(await player.getProperty<number>('time-pos')).toBeCloseTo(5, 1);
  });

  it('sends end-file with reason eof at the end when keep-open is off', async () => {
    const {player, log} = await openSample({'keep-open': 'no', speed: '16'});
    await player.setProperty('pause', false);
    await log.wait(() => log.has('end-file'), 'end-file');
    const end = log.events.find(e => e.event === 'end-file');
    expect(end).toMatchObject({event: 'end-file', reason: 'eof'});
  });

  it('keeps the last frame and sets eof-reached with keep-open=always, without end-file', async () => {
    const {player, log} = await openSample({'keep-open': 'always', speed: '16'});
    await player.setProperty('pause', false);
    await log.wait(() => log.values('eof-reached').includes(true), 'eof-reached');
    await sleep(200);
    expect(log.has('end-file')).toBe(false);
  });

  it('fires the lua auto-pause token and stops at the target time', async () => {
    const {player, log} = await openSample();
    await player.command(['script-message', 'set-auto-pause', '1.0', 'tok']);
    await player.setProperty('pause', false);
    await log.wait(() => log.values('user-data/auto-pause-fired').includes('tok'), 'auto-pause token');
    await waitFor(() => log.values('pause').at(-1) === true, 3000, 'pause after auto-pause');
    const time = await player.getProperty<number>('time-pos');
    expect(time).toBeLessThanOrEqual(1.0 + 1e-6);
    expect(time).toBeGreaterThan(0.9);
  });

  it('rejects unknown commands and properties with the mpv error code', async () => {
    const {player} = await openSample();
    await expect(player.getProperty('definitely-not-a-property')).rejects.toMatchObject({code: 'PROPERTY_NOT_FOUND'});
    await expect(player.command(['definitely-not-a-command'])).rejects.toMatchObject({code: 'INVALID_PARAMETER'});
    await expect(player.setProperty('volume', 'loud')).rejects.toMatchObject({mpvError: expect.any(Number)});
  });

  it('rejects an unsupported option when creating', () => {
    expect(() => createPlayer(env, {'no-such-option-at-all': 'x'})).toThrowError(LibmpvError);
  });

  it('resolves 200 concurrent getProperty calls', async () => {
    const {player} = await openSample();
    const results = await Promise.all(Array.from({length: 200}, (_, i) => player.getProperty(i % 2 ? 'volume' : 'speed')));
    expect(results).toHaveLength(200);
    expect(results.every(v => typeof v === 'number')).toBe(true);
  });

  it('rejects pending requests on destroy, resolves quickly and rejects afterwards', async () => {
    const {player} = await openSample();
    const pending = Array.from({length: 10}, () => player.getProperty('volume').then(() => 'resolved', (e: { code: string }) => e.code));
    const start = Date.now();
    await player.destroy();
    expect(Date.now() - start).toBeLessThan(2000);
    expect(await Promise.all(pending)).toEqual(Array(10).fill('DESTROYED'));
    await expect(player.getProperty('volume')).rejects.toMatchObject({code: 'DESTROYED'});
    await expect(player.command(['stop'])).rejects.toMatchObject({code: 'DESTROYED'});
    await player.destroy();
    expect(env.addon.liveCounts().cores).toBe(0);
  });

  it('does not leak across 20 create, play, destroy cycles', async () => {
    const cycle = async () => {
      const player = createPlayer(env);
      const log = new EventLog(player);
      await player.command(['loadfile', SAMPLE_MP4, 'replace']);
      await log.wait(() => log.has('playback-restart'), 'playback-restart');
      await player.setProperty('pause', false);
      await sleep(30);
      await player.destroy();
    };

    await cycle(); // warm up allocators before measuring
    const rssBefore = process.memoryUsage().rss;
    for (let i = 0; i < 20; i++) {
      await cycle();
    }
    expect(env.addon.liveCounts()).toEqual({cores: 0, eventThreads: 0, renderers: 0, renderThreads: 0, slots: 0});
    const growthMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
    expect(growthMb).toBeLessThan(50);
  });
});
