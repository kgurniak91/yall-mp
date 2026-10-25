import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {LibmpvManager} from '../../libmpv-manager';
import type {SubtitleSelection} from '../../src/app/model/project.types';
import type {MediaTrack} from '../../shared/types/media.type';
import {describeNative, ROOT, SAMPLE_51_MKV, SAMPLE_MP4, sleep, waitFor} from './support/native';

const NO_SUBTITLES = {type: 'none'} as unknown as SubtitleSelection;

describe('LibmpvManager with a real libmpv', () => {
  describeNative('libmpv', () => {
  const managers: LibmpvManager[] = [];
  let tempDir: string | undefined;

  afterEach(async () => {
    await Promise.all(managers.splice(0).map(m => m.stop()));
    if (tempDir) {
      fs.rmSync(tempDir, {recursive: true, force: true});
      tempDir = undefined;
    }
  });

  interface Opened {
    manager: LibmpvManager;
    statuses: any[];
  }

  const open = async (media = SAMPLE_MP4, extra: {
    audio?: number | null;
    sub?: SubtitleSelection;
    tracks?: MediaTrack[];
    volume?: number;
    mute?: boolean;
  } = {}): Promise<Opened> => {
    const manager = new LibmpvManager({
      basePath: ROOT,
      customLibmpvPath: process.env['YALL_LIBMPV_PATH'] || undefined,
      options: {ao: 'null', terminal: 'no'}
    });
    managers.push(manager);
    const statuses: any[] = [];
    manager.on('status', (s) => statuses.push(s));
    await manager.start(media, extra.audio ?? null, extra.sub ?? NO_SUBTITLES, extra.tracks ?? [], false, true, false,
      extra.volume ?? 100, extra.mute ?? false);
    return {manager, statuses};
  };

  const names = (statuses: any[]): string[] => statuses.map(s => s.event === 'property-change' ? `${s.name}` : s.event);
  const values = (statuses: any[], name: string): unknown[] =>
    statuses.filter(s => s.event === 'property-change' && s.name === name).map(s => s.data);

  it('starts paused, emits ready and reports the duration', async () => {
    const manager = new LibmpvManager({
      basePath: ROOT,
      customLibmpvPath: process.env['YALL_LIBMPV_PATH'] || undefined,
      options: {ao: 'null'}
    });
    managers.push(manager);
    let ready = false;
    manager.on('ready', () => ready = true);
    const statuses: any[] = [];
    manager.on('status', (s) => statuses.push(s));
    await manager.start(SAMPLE_MP4, null, NO_SUBTITLES, [], false, true, false, 100, false);
    expect(ready).toBe(true);
    await waitFor(() => values(statuses, 'duration').some(v => typeof v === 'number'), 5000, 'duration');
    expect(values(statuses, 'duration').find(v => typeof v === 'number') as number).toBeCloseTo(10, 0);
    expect(await manager.getProperty('pause')).toBe(true);
  });

  it('emits time-pos at about 10 Hz while playing and nothing while paused', async () => {
    const {manager, statuses} = await open();
    await sleep(400);
    expect(values(statuses, 'time-pos')).toEqual([]);

    await manager.setProperty('pause', false);
    await waitFor(() => values(statuses, 'pause').includes(false), 5000, 'unpause');
    statuses.length = 0;
    await sleep(2000);
    const times = values(statuses, 'time-pos');
    expect(times.every(t => typeof t === 'number')).toBe(true);
    expect(times.length).toBeGreaterThanOrEqual(12);
    expect(times.length).toBeLessThanOrEqual(24);
    expect(times[times.length - 1] as number).toBeGreaterThan(times[0] as number);

    await manager.setProperty('pause', true);
    await waitFor(() => values(statuses, 'pause').includes(true), 5000, 'pause');
    statuses.length = 0;
    await sleep(500);
    expect(values(statuses, 'time-pos')).toEqual([]);
  });

  it('emits playback-restart then seek', async () => {
    const {manager, statuses} = await open();
    statuses.length = 0;
    await manager.sendCommand(['seek', 5, 'absolute']);
    await waitFor(() => names(statuses).includes('seek'), 5000, 'seek');
    expect(names(statuses).filter(n => n === 'playback-restart' || n === 'seek')).toEqual(['playback-restart', 'seek']);

    statuses.length = 0;
    await manager.sendCommand(['seek', 2, 'absolute', 'exact']);
    await manager.sendCommand(['seek', 7, 'absolute', 'exact']);
    await waitFor(() => names(statuses).includes('seek'), 5000, 'seek after quick seeks');
    await sleep(300);
    // mpv may coalesce the two seeks into one restart, but a seek never comes without a restart before it
    const order = names(statuses).filter(n => n === 'playback-restart' || n === 'seek');
    expect(order[0]).toBe('playback-restart');
    expect(order.filter(n => n === 'seek').length).toBeLessThanOrEqual(order.filter(n => n === 'playback-restart').length);
    expect(await manager.getProperty('time-pos')).toBeCloseTo(7, 0);
  });

  it('pauses at the auto-pause target and reports the token', async () => {
    const {manager, statuses} = await open();
    await manager.setLuaAutoPause(1.0, 'tok');
    await manager.setProperty('pause', false);
    await waitFor(() => statuses.some(s => s.event === 'auto-pause-fired'), 8000, 'auto-pause-fired');
    expect(statuses.find(s => s.event === 'auto-pause-fired').data).toBe('tok');
    await waitFor(() => values(statuses, 'pause').lastIndexOf(true) > values(statuses, 'pause').lastIndexOf(false), 5000, 'pause');
    expect(await manager.getProperty('time-pos')).toBeLessThan(1.2);
  });

  it('keeps the file at eof without an end-file, and stop produces exactly one', async () => {
    const {manager, statuses} = await open();
    await manager.setProperty('speed', 8);
    await manager.setProperty('pause', false);
    await waitFor(() => values(statuses, 'eof-reached').includes(true), 10000, 'eof-reached');
    expect(names(statuses)).not.toContain('end-file');

    await manager.sendCommand(['stop']);
    await waitFor(() => names(statuses).includes('end-file'), 5000, 'end-file');
    await sleep(200);
    expect(names(statuses).filter(n => n === 'end-file')).toHaveLength(1);
  });

  it('plays a file with a non-ASCII path', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-mgr-'));
    const unicode = path.join(tempDir, 'sample ąęł.mp4');
    fs.copyFileSync(SAMPLE_MP4, unicode);
    const {manager} = await open(unicode);
    expect(await manager.getProperty('duration')).toBeCloseTo(10, 0);
  });

  it('rejects start for a file that does not exist', async () => {
    await expect(open(path.join(ROOT, 'test', 'e2e', 'fixtures', 'missing.mp4'))).rejects.toThrow();
  });

  it('selects the embedded subtitle track with the relative sid mapping', async () => {
    const probe = await open(SAMPLE_51_MKV);
    const trackList = await probe.manager.getProperty('track-list') as Array<{ type: string; id: number; 'ff-index': number }>;
    const sub = trackList.find(t => t.type === 'sub');
    expect(sub).toBeDefined();
    await probe.manager.stop();

    const {manager} = await open(SAMPLE_51_MKV, {
      sub: {type: 'embedded', trackIndex: sub!['ff-index']} as SubtitleSelection,
      tracks: [{index: sub!['ff-index']} as MediaTrack]
    });
    expect(await manager.getProperty('sid')).toBe(1);
  });

  it('applies the initial volume and mute', async () => {
    const {manager} = await open(SAMPLE_MP4, {volume: 35, mute: true});
    expect(await manager.getProperty('volume')).toBe(35);
    expect(await manager.getProperty('mute')).toBe(true);
  });

  it('stops twice without trouble', async () => {
    const {manager} = await open();
    await manager.stop();
    await manager.stop();
    await expect(manager.getProperty('pause')).rejects.toThrow('not running');
  });
});
});
