import {describe, expect, it} from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {evaluate, excessPerHour} = require('../scripts/soak-verdict');

/** One sample per minute, 0..60, with the given renderer heap and flat process memory. */
const run = (heap: (minute: number) => number) => Array.from({length: 61}, (_, minute) => ({
  minute, heapMB: heap(minute), byType: {Browser: {privateMB: 100, workingSetMB: 120}},
  inFlight: 1, poolSize: 4, reclaimed: 0, sendFailures: 0, openFrames: 1
}));

const verdictOf = (heap: (minute: number) => number) => evaluate(run(heap), [], 10);

describe('soak verdict, renderer JS heap', () => {
  it('passes a flat heap', () => {
    expect(verdictOf(() => 60).pass).toBe(true);
  });

  it('passes a heap that steps down and back up to a level it already had', () => {
    // The readback soak of 2026-11-03: 77.6 MB, 51.0 MB in minutes 19-38, then 77.6 MB again
    const verdict = verdictOf(m => m >= 19 && m <= 38 ? 51 : 77.6);
    expect(verdict.growthSecondHalfMBPerHour.rendererJsHeap).toBeGreaterThan(10); // the linear fit alone would fail it
    expect(verdict.heapExcessMBPerHour).toBe(0);
    expect(verdict.pass).toBe(true);
  });

  it('fails a heap that keeps growing', () => {
    const verdict = verdictOf(m => 50 + m * 0.5); // 30 MB/h
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.join()).toMatch(/renderer JS heap grows/);
    expect(verdict.heapExcessMBPerHour).toBeCloseTo(30, 0);
  });

  it('fails a slow leak just over the limit, also behind a high start-up value', () => {
    const verdict = verdictOf(m => m < 3 ? 70 : 50 + m * (12 / 60));
    expect(verdict.pass).toBe(false);
  });

  it('fails a heap that steps up past everything it had before', () => {
    expect(verdictOf(m => m < 40 ? 50 : 80).pass).toBe(false);
  });

  it('needs enough points', () => {
    expect(excessPerHour([[0, 1], [1, 2]])).toBeNull();
  });
});

describe('soak verdict, other gates', () => {
  it('fails process memory that keeps growing', () => {
    const samples = run(() => 60).map(s => ({...s, byType: {Browser: {privateMB: 100 + s.minute, workingSetMB: 0}}}));
    expect(evaluate(samples, [], 10).failures.join()).toMatch(/Browser grows/);
  });

  it('passes a noisy working set whose floor does not move (macOS readback: frames in flight)', () => {
    // The readback soak of 2026-11-04: a 400-410 MB floor and spikes that are larger late in the run
    const spike = (m: number) => m % 3 !== 0 ? 0 : m > 30 ? (m - 30) * 2 : 15;
    const samples = run(() => 17).map(s => ({...s, byType: {Browser: {privateMB: 0, workingSetMB: 405 + spike(s.minute)}}}));
    const verdict = evaluate(samples, [], 10);
    expect(verdict.growthSecondHalfMBPerHour.Browser).toBeGreaterThanOrEqual(30); // the fit alone would fail it
    expect(verdict.excessPastPeakMBPerHour.Browser).toBeLessThan(30);
    expect(verdict.pass).toBe(true);
  });

  it('still fails send failures and reclaimed slots', () => {
    const samples = run(() => 60);
    samples[30] = {...samples[30], sendFailures: 1, reclaimed: 1};
    expect(evaluate(samples, [], 10).failures).toEqual(['slots were reclaimed', 'frame send failures']);
  });
});
