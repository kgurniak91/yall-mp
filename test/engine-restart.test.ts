import {describe, expect, it, vi} from 'vitest';
import {EventEmitter} from 'events';
import {EngineRestartPolicy} from '../engine-restart';
import {PlaybackManager} from '../playback-manager';
import {PlayerState} from '../src/app/model/video.types';
import {DEFAULT_PROJECT_SETTINGS} from '../src/app/model/settings.types';
import type {LibmpvManager} from '../libmpv-manager';
import type {BrowserWindow} from 'electron';

describe('EngineRestartPolicy', () => {
  it('allows the first restart', () => {
    expect(new EngineRestartPolicy().tryRestart(1000)).toBe(true);
  });

  it('gives up on a second failure within the window', () => {
    const policy = new EngineRestartPolicy(60_000);
    expect(policy.tryRestart(1000)).toBe(true);
    expect(policy.tryRestart(30_000)).toBe(false);
  });

  it('allows another restart once the window has passed', () => {
    const policy = new EngineRestartPolicy(60_000);
    expect(policy.tryRestart(1000)).toBe(true);
    expect(policy.tryRestart(61_000)).toBe(true);
  });

  it('forgets earlier restarts after a reset (a new project)', () => {
    const policy = new EngineRestartPolicy(60_000);
    policy.tryRestart(1000);
    policy.reset();
    expect(policy.tryRestart(2000)).toBe(true);
  });
});

describe('PlaybackManager.rebind', () => {
  const fakeManager = () => Object.assign(new EventEmitter(), {
    setProperty: vi.fn(), sendCommand: vi.fn(), showSubtitles: vi.fn(), hideSubtitles: vi.fn(), setLuaAutoPause: vi.fn()
  });
  const window = {isDestroyed: () => false, webContents: {send: vi.fn()}} as unknown as BrowserWindow;

  it('listens to the new engine only and keeps the position', () => {
    const oldManager = fakeManager();
    const newManager = fakeManager();
    const playback = new PlaybackManager(oldManager as unknown as LibmpvManager, window);
    playback.loadProject([{id: 'a', startTime: 0, endTime: 10, hasSubtitle: true}], {...DEFAULT_PROJECT_SETTINGS}, 3, {enabled: false, speed: 1});
    oldManager.emit('status', {event: 'property-change', name: 'time-pos', data: 4.5});
    expect(playback.position).toBe(4.5);

    playback.rebind(newManager as unknown as LibmpvManager);
    oldManager.emit('status', {event: 'property-change', name: 'time-pos', data: 9});
    expect(playback.position).toBe(4.5);
    newManager.emit('status', {event: 'property-change', name: 'time-pos', data: 5});
    expect(playback.position).toBe(5);

    playback.pause();
    expect(newManager.setProperty).toHaveBeenCalledWith('pause', true);
    expect(oldManager.setProperty).not.toHaveBeenCalled();
    expect(PlayerState.PausedByUser).toBeDefined();
  });
});
