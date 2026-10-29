import {describe, expect, it} from 'vitest';
import {FullscreenTransitionGuard} from '../fullscreen-transition';

describe('FullscreenTransitionGuard', () => {
  it('allows entering and leaving when nothing happened before', () => {
    const guard = new FullscreenTransitionGuard();
    expect(guard.tryBegin(true, 1000)).toBe(true);
    expect(guard.tryBegin(false, 1000)).toBe(true);
  });

  it('lets a quick Escape leave right after entering', () => {
    const guard = new FullscreenTransitionGuard(150, 1500);
    expect(guard.tryBegin(true, 1000)).toBe(true);
    guard.end(true, 1100);
    expect(guard.tryBegin(false, 1110)).toBe(true);
  });

  it('drops entering while a leave is pending', () => {
    const guard = new FullscreenTransitionGuard(150, 1500);
    expect(guard.tryBegin(false, 1000)).toBe(true);
    expect(guard.tryBegin(true, 1050)).toBe(false);
    expect(guard.tryBegin(true, 1400)).toBe(false);
  });

  it('keeps dropping entering for a moment after the leave event, then allows it', () => {
    const guard = new FullscreenTransitionGuard(150, 1500);
    guard.tryBegin(false, 1000);
    guard.end(false, 1300);
    expect(guard.tryBegin(true, 1400)).toBe(false);
    expect(guard.tryBegin(true, 1450)).toBe(true);
  });

  it('is not blocked forever by a leave that never produced an event', () => {
    const guard = new FullscreenTransitionGuard(150, 1500);
    guard.tryBegin(false, 1000);
    expect(guard.tryBegin(true, 2499)).toBe(false);
    expect(guard.tryBegin(true, 2500)).toBe(true);
  });

  it('a burst of toggles at 50 ms: enter, leave, then the re-entries are dropped until the leave settled', () => {
    const guard = new FullscreenTransitionGuard(150, 1500);
    const results: boolean[] = [];
    let fullscreen = false;
    for (const t of [0, 50, 100, 150, 200]) {
      const entering = !fullscreen;
      const ok = guard.tryBegin(entering, 1000 + t);
      results.push(ok);
      if (ok) {
        fullscreen = entering;
        // the OS reports the event shortly after the request
        guard.end(entering, 1000 + t + 20);
      }
    }
    // Enter at 0 and leave at 50 go through; the leave settles at 1220, so the entries at 100, 150 and 200 are dropped
    expect(results).toEqual([true, true, false, false, false]);
  });
});
