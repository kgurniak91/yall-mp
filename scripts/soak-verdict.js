// Pass/fail verdict of scripts/soak-video.js, separate so it can be unit tested and re-run on a saved result
// (`node scripts/soak-video.js --recheck=<result.json>`).

/** Least-squares slope of y over x (x in minutes), returned per hour. */
function slopePerHour(points) {
  if (points.length < 3) {
    return null;
  }
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const num = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den === 0 ? null : (num / den) * 60;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * How fast the value climbs past everything it reached in the first half, per hour: the median of the last quarter of
 * the run minus the highest value of the first half after the warm-up, over the time between that peak and the last
 * quarter (the warm-up is left out so a high start-up value cannot hide a slow leak). A leak keeps
 * climbing, so it scores its own rate; a value that steps down and back up to a level it already had (a buffer pool
 * released and refilled) scores 0, where a linear fit over the second half would read the step as growth.
 * `points` are [minute, value]; null when there are too few points.
 */
function excessPerHour(points, warmupMin = 0) {
  if (points.length < 8) {
    return null;
  }
  const last = points[points.length - 1][0];
  const firstHalfAll = points.filter(p => p[0] < last / 2);
  const firstHalfWarm = firstHalfAll.filter(p => p[0] >= warmupMin);
  const firstHalf = firstHalfWarm.length > 0 ? firstHalfWarm : firstHalfAll;
  const lastQuarter = points.filter(p => p[0] >= last * 0.75);
  if (firstHalf.length === 0 || lastQuarter.length === 0) {
    return null;
  }
  const peak = firstHalf.reduce((best, p) => p[1] >= best[1] ? p : best);
  const end = median(lastQuarter.map(p => p[1]));
  const endMinute = median(lastQuarter.map(p => p[0]));
  const hours = (endMinute - peak[0]) / 60;
  return hours <= 0 ? null : Math.max(0, end - peak[1]) / hours;
}

/**
 * Applies the soak criteria to the per-minute samples. A memory value fails when the linear fit over the second half
 * reaches its limit AND it climbs past its first-half peak at that rate too: the renderer JS heap moves in steps of
 * whole frame buffers, and the macOS working set of the browser process jumps by the frames in flight (readback: +-25
 * MB from minute to minute), which a fit alone reads as growth. A leak passes both.
 */
function evaluate(samples, reopenSnapshots, warmupMin) {
  const failures = [];
  const warm = samples.filter(s => s.minute >= warmupMin);
  const lastMinute = samples.at(-1)?.minute ?? 0;
  const secondHalf = samples.filter(s => s.minute >= lastMinute / 2);
  const growth = {};
  const growthSecondHalf = {};
  const types = new Set(samples.flatMap(s => Object.keys(s.byType)));
  const has = v => v !== null && v !== undefined;
  const fit = (list, pick) => {
    const g = slopePerHour(list.filter(s => has(pick(s))).map(s => [s.minute, pick(s)]));
    return g === null ? null : Number(g.toFixed(1));
  };
  const excess = {};
  for (const type of types) {
    const pick = s => s.byType[type] ? (s.byType[type].privateMB || s.byType[type].workingSetMB) : null;
    growth[type] = fit(warm, pick);
    growthSecondHalf[type] = fit(secondHalf, pick);
    const e = excessPerHour(samples.filter(s => has(pick(s))).map(s => [s.minute, pick(s)]), warmupMin);
    excess[type] = e === null ? null : Number(e.toFixed(1));
    if (growthSecondHalf[type] !== null && growthSecondHalf[type] >= 30 && (e === null || e >= 30)) {
      failures.push(`${type} grows ${growthSecondHalf[type].toFixed(1)} MB/h over the second half and ${excess[type] ?? '?'} MB/h ` +
        'past its first-half peak (limit 30)');
    }
  }
  const heap = s => s.heapMB;
  growth.rendererJsHeap = fit(warm, heap);
  growthSecondHalf.rendererJsHeap = fit(secondHalf, heap);
  const heapExcess = excessPerHour(samples.filter(s => has(heap(s))).map(s => [s.minute, heap(s)]), warmupMin);
  const heapExcessMBPerHour = heapExcess === null ? null : Number(heapExcess.toFixed(1));
  excess.rendererJsHeap = heapExcessMBPerHour;
  if (growthSecondHalf.rendererJsHeap !== null && growthSecondHalf.rendererJsHeap >= 10 && (heapExcess === null || heapExcess >= 10)) {
    failures.push(`renderer JS heap grows ${growthSecondHalf.rendererJsHeap.toFixed(1)} MB/h over the second half and ` +
      `${heapExcessMBPerHour ?? '?'} MB/h past its first-half peak (limit 10)`);
  }
  const worst = pick => Math.max(0, ...samples.map(s => pick(s) ?? 0));
  const maxInFlight = worst(s => s.inFlight);
  const pool = samples.find(s => s.poolSize)?.poolSize ?? 4;
  if (maxInFlight > pool) {
    failures.push(`inFlight reached ${maxInFlight} (pool ${pool})`);
  }
  if (worst(s => s.reclaimed) !== 0) {
    failures.push('slots were reclaimed');
  }
  if (worst(s => s.sendFailures) !== 0) {
    failures.push('frame send failures');
  }
  const maxOpen = worst(s => s.openFrames);
  if (maxOpen > 2) {
    failures.push(`${maxOpen} VideoFrames open at once (limit 2)`);
  }
  const [first, ...rest] = reopenSnapshots;
  for (const snap of rest) {
    if (JSON.stringify(snap.listeners) !== JSON.stringify(first.listeners)) {
      failures.push(`listener counts changed after reopen at minute ${snap.minute}`);
    }
    // Slots are allocated lazily and held while a frame is in flight, so they are bounded, not compared
    const {slots: firstSlots, ...firstCounts} = first.live;
    const {slots, ...counts} = snap.live;
    if (JSON.stringify(counts) !== JSON.stringify(firstCounts) || slots > Math.max(4, firstSlots)) {
      failures.push(`addon liveCounts changed after reopen at minute ${snap.minute}: ${JSON.stringify(snap.live)} vs ${JSON.stringify(first.live)}`);
    }
  }
  return {
    growthMBPerHour: growth, growthSecondHalfMBPerHour: growthSecondHalf, excessPastPeakMBPerHour: excess, heapExcessMBPerHour,
    maxInFlight, maxOpenFrames: maxOpen,
    failures, pass: failures.length === 0
  };
}

module.exports = {slopePerHour, excessPerHour, evaluate};
