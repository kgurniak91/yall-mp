import {describe, expect, it} from 'vitest';
import {
  FULLSCREEN_REPAIR_DIMMED_OPACITY,
  FULLSCREEN_REPAIR_HOLD_MS,
  FullscreenRepairPulse,
  FullscreenTransitionGuard
} from '../fullscreen-transition';

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

describe('FullscreenRepairPulse', () => {
  const setup = () => {
    let now = 0;
    const pending: { at: number; run: () => void; id: number }[] = [];
    let nextId = 1;
    const opacities: number[] = [];
    const pulse = new FullscreenRepairPulse(
      (opacity) => opacities.push(opacity),
      (run, ms) => {
        const id = nextId++;
        pending.push({at: now + ms, run, id});
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      (handle) => {
        const index = pending.findIndex(p => p.id === (handle as unknown as number));
        if (index >= 0) {
          pending.splice(index, 1);
        }
      }
    );
    const advance = (ms: number) => {
      const target = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > target) {
          break;
        }
        pending.shift();
        now = next.at;
        next.run();
      }
      now = target;
    };
    return {pulse, advance, opacities};
  };

  it('dips the opacity about a second after entering and restores it after the hold time', () => {
    const {pulse, advance, opacities} = setup();
    pulse.start();
    advance(999);
    expect(opacities).toEqual([]);
    advance(1);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY]);
    advance(FULLSCREEN_REPAIR_HOLD_MS);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY, 1]);
  });

  it('dips again later for a bad state that shows up late', () => {
    const {pulse, advance, opacities} = setup();
    pulse.start();
    advance(3000);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY, 1, FULLSCREEN_REPAIR_DIMMED_OPACITY, 1]);
  });

  it('cancels the pending dips when fullscreen is left, without touching the opacity', () => {
    const {pulse, advance, opacities} = setup();
    pulse.start();
    advance(500);
    pulse.stop();
    advance(5000);
    expect(opacities).toEqual([]);
  });

  it('restores the opacity when fullscreen is left in the middle of a dip', () => {
    const {pulse, advance, opacities} = setup();
    pulse.start();
    advance(1050);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY]);
    pulse.stop();
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY, 1]);
    advance(5000);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY, 1]);
  });

  it('starting again replaces the pending dips of the previous entry', () => {
    const {pulse, advance, opacities} = setup();
    pulse.start();
    advance(600);
    pulse.start();
    advance(999);
    expect(opacities).toEqual([]);
    advance(1);
    expect(opacities).toEqual([FULLSCREEN_REPAIR_DIMMED_OPACITY]);
  });
});
