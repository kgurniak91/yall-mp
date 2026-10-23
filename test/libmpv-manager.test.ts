import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {EventEmitter} from 'events';
import {LibmpvManager} from '../libmpv-manager';
import {Libmpv, LibmpvEvent} from '../libmpv-bridge';
import type {MediaTrack} from '../shared/types/media.type';

class FakeLibmpv extends EventEmitter {
  command = vi.fn(async (args: string[]) => {
    if (args[0] === 'loadfile') {
      queueMicrotask(() => this.loadResult());
    }
    return undefined;
  });
  setProperty = vi.fn(async () => undefined);
  getProperty = vi.fn(async () => 42);
  observeProperty = vi.fn(() => 1);
  requestLogMessages = vi.fn();
  destroy = vi.fn(async () => undefined);
  loadResult: () => void = () => this.send({event: 'file-loaded'});

  send(event: LibmpvEvent): void {
    this.emit('event', event);
  }

  prop(name: string, data: unknown): void {
    this.send({event: 'property-change', id: 1, name, data});
  }
}

const tracks = [{index: 3}, {index: 5}, {index: 8}] as MediaTrack[];
const noSubs = {type: 'none'} as never;

describe('LibmpvManager', () => {
  let fake: FakeLibmpv;
  let optionsSeen: Record<string, string>;
  let manager: LibmpvManager;
  let statuses: any[];

  const create = (extra: Partial<ConstructorParameters<typeof LibmpvManager>[0]> = {}) => {
    manager = new LibmpvManager({
      basePath: '/base',
      platform: 'win32',
      libmpvFactory: (options) => {
        optionsSeen = options;
        return fake as unknown as Libmpv;
      },
      ...extra
    });
    statuses = [];
    manager.on('status', (s) => statuses.push(s));
  };

  const start = (overrides: { audio?: number | null; sub?: any; hw?: boolean; volume?: number; mute?: boolean; mpvSubs?: boolean; visible?: boolean } = {}) =>
    manager.start('/media/a.mp4', overrides.audio ?? null, overrides.sub ?? noSubs, tracks, overrides.mpvSubs ?? false,
      overrides.visible ?? true, overrides.hw ?? true, overrides.volume ?? 80, overrides.mute ?? false);

  beforeEach(() => {
    vi.useFakeTimers();
    fake = new FakeLibmpv();
    create();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the option map', async () => {
    await start({audio: 2, hw: false, volume: 55, mute: true});
    expect(optionsSeen).toMatchObject({
      vo: 'null', hwdec: 'no', volume: '55', mute: 'yes', aid: '2', 'keep-open': 'always', pause: 'yes'
    });
    expect(optionsSeen['scripts']).toMatch(/yall_auto_pause\.lua$/);
    expect(optionsSeen).not.toHaveProperty('wid');
    expect(optionsSeen).not.toHaveProperty('sid');
  });

  it('maps the ffprobe subtitle index to the 1-based relative sid', async () => {
    await start({sub: {type: 'embedded', trackIndex: 5}});
    expect(optionsSeen['sid']).toBe('2');
    expect(fake.setProperty).toHaveBeenCalledWith('sid', 2);
  });

  it('lets config options override the defaults', async () => {
    create({options: {ao: 'null', hwdec: 'no'}});
    await start();
    expect(optionsSeen).toMatchObject({ao: 'null', hwdec: 'no'});
  });

  it('adds external subtitles and applies the visibility', async () => {
    await start({sub: {type: 'external', filePath: '/s.srt'}, mpvSubs: true, visible: true});
    expect(fake.command).toHaveBeenCalledWith(['sub-add', '/s.srt', 'select']);
    expect(fake.setProperty).toHaveBeenLastCalledWith('sub-visibility', true);
  });

  it('hides mpv subtitles when they are not used', async () => {
    await start({mpvSubs: false, visible: true});
    expect(fake.setProperty).toHaveBeenLastCalledWith('sub-visibility', false);
  });

  it('refuses to start on Linux without touching the addon', async () => {
    const factory = vi.fn();
    create({platform: 'linux', libmpvFactory: factory});
    await expect(start()).rejects.toThrow(/not supported on Linux/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('emits ready after the file loaded and observes the properties', async () => {
    const ready = vi.fn();
    manager.on('ready', ready);
    await start();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(fake.command).toHaveBeenCalledWith(['loadfile', '/media/a.mp4', 'replace']);
    expect(fake.observeProperty).toHaveBeenCalledWith('time-pos');
    expect(fake.observeProperty).toHaveBeenCalledWith('user-data/auto-pause-fired');
    manager.observeProperty('time-pos');
    expect(fake.observeProperty).toHaveBeenCalledTimes(8);
  });

  it('rejects and destroys when the file fails to load', async () => {
    fake.loadResult = () => fake.send({event: 'end-file', reason: 'error', error: {code: 'LOADING_FAILED', message: 'bad file'}});
    await expect(start()).rejects.toThrow('bad file');
    expect(fake.destroy).toHaveBeenCalled();
    await expect(manager.getProperty('pause')).rejects.toThrow('not running');
  });

  it('rejects when loading times out', async () => {
    fake.loadResult = () => undefined;
    const result = expect(start()).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(15001);
    await result;
  });

  describe('video output', () => {
    it('uses vo=libmpv and runs the hook after creation and before loadfile', async () => {
      const order: string[] = [];
      const hook = vi.fn((libmpv: Libmpv) => {
        expect(libmpv).toBe(fake);
        order.push('attach');
      });
      fake.command.mockImplementation(async (args: string[]) => {
        order.push(args[0]);
        if (args[0] === 'loadfile') {
          queueMicrotask(() => fake.loadResult());
        }
      });
      create({attachVideo: hook});
      await start();
      expect(optionsSeen['vo']).toBe('libmpv');
      expect(order.slice(0, 2)).toEqual(['attach', 'loadfile']);
    });

    it('runs the disposer first in stop(), once', async () => {
      const order: string[] = [];
      const dispose = vi.fn(() => order.push('dispose'));
      fake.destroy.mockImplementation(async () => { order.push('destroy'); });
      create({attachVideo: () => dispose});
      await start();
      await manager.stop();
      await manager.stop();
      expect(order).toEqual(['dispose', 'destroy']);
    });

    it('rejects start and stops when the hook throws', async () => {
      create({attachVideo: () => { throw new Error('no surface'); }});
      await expect(start()).rejects.toThrow('no surface');
      expect(fake.destroy).toHaveBeenCalled();
      expect(fake.command).not.toHaveBeenCalledWith(['loadfile', '/media/a.mp4', 'replace']);
    });

    it('survives a throwing disposer', async () => {
      create({attachVideo: () => () => { throw new Error('boom'); }});
      await start();
      await manager.stop();
      expect(fake.destroy).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    beforeEach(async () => {
      await start();
    });

    it('throttles time-pos to 10 Hz and stays silent while paused', () => {
      fake.prop('time-pos', 1);
      vi.advanceTimersByTime(500);
      expect(statuses.filter(s => s.name === 'time-pos')).toHaveLength(0);

      fake.prop('pause', false);
      fake.prop('time-pos', 2);
      fake.prop('time-pos', 2.1);
      statuses.length = 0;
      vi.advanceTimersByTime(1000);
      const times = statuses.filter(s => s.name === 'time-pos');
      expect(times).toHaveLength(10);
      expect(times[0]).toEqual({event: 'property-change', name: 'time-pos', data: 2.1});

      fake.prop('pause', true);
      statuses.length = 0;
      vi.advanceTimersByTime(500);
      expect(statuses).toEqual([]);
    });

    it('emits pause changes and normalises null to undefined', () => {
      fake.prop('pause', false);
      fake.prop('duration', null);
      fake.prop('volume', 70);
      expect(statuses).toEqual([
        {event: 'property-change', name: 'pause', data: false},
        {event: 'property-change', name: 'duration', data: undefined},
        {event: 'property-change', name: 'volume', data: 70}
      ]);
    });

    it('emits playback-restart then seek, one seek per restart', () => {
      fake.send({event: 'seek'});
      fake.send({event: 'playback-restart'});
      expect(statuses.map(s => s.event)).toEqual(['playback-restart', 'seek']);

      statuses.length = 0;
      fake.send({event: 'seek'});
      fake.send({event: 'playback-restart'});
      fake.send({event: 'seek'});
      fake.send({event: 'playback-restart'});
      expect(statuses.map(s => s.event)).toEqual(['playback-restart', 'seek', 'playback-restart', 'seek']);

      // mpv coalesces two quick seeks into a single restart
      statuses.length = 0;
      fake.send({event: 'seek'});
      fake.send({event: 'seek'});
      fake.send({event: 'playback-restart'});
      fake.send({event: 'playback-restart'});
      expect(statuses.map(s => s.event)).toEqual(['playback-restart', 'seek', 'playback-restart']);
    });

    it('does not emit seek for a restart without a seek', () => {
      fake.send({event: 'playback-restart'});
      expect(statuses.map(s => s.event)).toEqual(['playback-restart']);
    });

    it('turns the idle-active true transition into one end-file, ignoring the initial value', () => {
      fake.prop('idle-active', true);
      expect(statuses).toEqual([]);
      fake.prop('idle-active', false);
      fake.prop('idle-active', true);
      expect(statuses).toEqual([{event: 'end-file'}]);
    });

    it('does not forward the raw end-file event', () => {
      fake.send({event: 'end-file', reason: 'stop'});
      expect(statuses).toEqual([]);
    });

    it('forwards the auto-pause token and drops the empty one', () => {
      fake.prop('user-data/auto-pause-fired', '');
      fake.prop('user-data/auto-pause-fired', 'tok');
      expect(statuses).toEqual([{event: 'auto-pause-fired', data: 'tok'}]);
    });

    it('reports an unexpected shutdown but not one caused by stop()', async () => {
      const onError = vi.fn();
      manager.on('error', onError);
      await manager.stop();
      fake.send({event: 'shutdown'});
      expect(onError).not.toHaveBeenCalled();

      fake = new FakeLibmpv();
      await start();
      fake.send({event: 'shutdown'});
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('commands', () => {
    beforeEach(async () => {
      await start();
      fake.command.mockClear();
      fake.setProperty.mockClear();
    });

    it('stringifies command arguments', async () => {
      await manager.sendCommand(['seek', 12.5, 'absolute', 'exact']);
      expect(fake.command).toHaveBeenCalledWith(['seek', '12.5', 'absolute', 'exact']);
    });

    describe('a seek that mpv refuses', () => {
      beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      });

      it('is issued again when the file is loaded again', async () => {
        fake.command.mockRejectedValueOnce(new Error('error running command'));
        await manager.sendCommand(['seek', 4.75, 'absolute']);
        fake.command.mockClear();

        fake.send({event: 'file-loaded'});
        await Promise.resolve();
        expect(fake.command).toHaveBeenCalledWith(['seek', '4.75', 'absolute']);

        // Only once
        fake.command.mockClear();
        fake.send({event: 'file-loaded'});
        await Promise.resolve();
        expect(fake.command).not.toHaveBeenCalled();
      });

      it('is forgotten once a later seek succeeds', async () => {
        fake.command.mockRejectedValueOnce(new Error('error running command'));
        await manager.sendCommand(['seek', 4.75, 'absolute']);
        await manager.sendCommand(['seek', 8, 'absolute']);
        fake.command.mockClear();

        fake.send({event: 'file-loaded'});
        await Promise.resolve();
        expect(fake.command).not.toHaveBeenCalled();
      });

      it('is not remembered for relative seeks or other commands', async () => {
        fake.command.mockRejectedValueOnce(new Error('error running command'));
        await manager.sendCommand(['seek', 2, 'relative']);
        fake.command.mockRejectedValueOnce(new Error('error running command'));
        await manager.sendCommand(['script-message', 'x']);
        fake.command.mockClear();

        fake.send({event: 'file-loaded'});
        await Promise.resolve();
        expect(fake.command).not.toHaveBeenCalled();
      });
    });

    it('sets the auto-pause through the lua script', async () => {
      await manager.setLuaAutoPause(4.2, 'tok');
      expect(fake.command).toHaveBeenCalledWith(['script-message', 'set-auto-pause', '4.2', 'tok']);
    });

    it('toggles subtitle visibility', async () => {
      await manager.showSubtitles();
      await manager.hideSubtitles();
      expect(fake.setProperty.mock.calls).toEqual([['sub-visibility', true], ['sub-visibility', false]]);
    });

    it('swallows failures of fire-and-forget calls but not getProperty', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fake.command.mockRejectedValueOnce(new Error('boom'));
      fake.setProperty.mockRejectedValueOnce(new Error('boom'));
      await expect(manager.sendCommand(['seek', 1, 'absolute'])).resolves.toBeUndefined();
      await expect(manager.setProperty('pause', true)).resolves.toBeUndefined();
      fake.getProperty.mockRejectedValueOnce(new Error('nope'));
      await expect(manager.getProperty('x')).rejects.toThrow('nope');
      expect(warn).toHaveBeenCalled();
    });

    it('resolves quietly after stop and stop is idempotent', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await manager.stop();
      await manager.stop();
      expect(fake.destroy).toHaveBeenCalledTimes(1);
      await expect(manager.sendCommand(['seek', 1, 'absolute'])).resolves.toBeUndefined();
      await expect(manager.getProperty('pause')).rejects.toThrow('libmpv is not running.');
      expect(warn).toHaveBeenCalled();
    });

    it('stops the time-pos timer on stop', async () => {
      fake.prop('pause', false);
      fake.prop('time-pos', 3);
      await manager.stop();
      statuses.length = 0;
      vi.advanceTimersByTime(1000);
      expect(statuses).toEqual([]);
    });
  });
});
