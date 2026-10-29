import {expect, test} from './support/app';
import {CLIPS, inClip, NEAR_END} from './support/clips';
import {
  describeSteps, expectDomSubtitle, launchClips, mpvPaused, mpvTime, press, quiet, setProjectSwitch, snapshot, startPlaying, stepsSince,
  waitForState, type Step
} from './support/player';
import type {Page} from '@playwright/test';

// Auto-pause against the real engine: every combination of "pause at start", "pause at end" and "skip gaps" walks the whole
// fixture, and the places where playback comes to rest must match the rules below.

const hasSub = (i: number): boolean => CLIPS[i].hasSubtitle;

/**
 * Where the player rests when playing from the first clip (a gap) to the end of the file and the user resumes at every rest.
 * Reference model of the rules: at a clip's end it rests if auto-pause-at-end is on and the clip has a subtitle, or if skip-gaps
 * is on and no subtitled clip is left. The next clip is the following one, or the following subtitled one with skip-gaps.
 * Entering a subtitled clip rests at its start when auto-pause-at-start is on.
 */
function expectedRests(atStart: boolean, atEnd: boolean, skipGaps: boolean): Step[] {
  const rests: Step[] = [];
  const next = (i: number): number => {
    let n = i + 1;
    if (skipGaps) {
      while (n < CLIPS.length && !hasSub(n)) {
        n++;
      }
    }
    return n;
  };

  let clip = 0;
  for (; ;) {
    const n = next(clip);
    if ((atEnd && hasSub(clip)) || (skipGaps && n >= CLIPS.length)) {
      rests.push({state: 'AutoPausedAtEnd', clip});
    }
    if (n >= CLIPS.length) {
      break;
    }
    clip = n;
    if (atStart && hasSub(clip)) {
      rests.push({state: 'AutoPausedAtStart', clip});
    }
  }
  return rests;
}

/** Waits for the next resting place (an auto-pause that is not `previous`) or the end of the file. */
async function waitForRest(ui: Page, previous: Step | null): Promise<Step | 'Ended'> {
  let found: Step | 'Ended' | null = null;
  await expect.poll(async () => {
    const s = await snapshot(ui);
    if (!s) {
      return false;
    }
    if (s.playerState === 'Ended') {
      found = 'Ended';
      return true;
    }
    if ((s.playerState === 'AutoPausedAtStart' || s.playerState === 'AutoPausedAtEnd')
      && !(previous && previous.state === s.playerState && previous.clip === s.currentClipIndex)) {
      found = {state: s.playerState, clip: s.currentClipIndex};
      return true;
    }
    return false;
  }, {timeout: 30_000, message: 'playback should come to a rest or end'}).toBe(true);
  return found!;
}

for (const atStart of [false, true]) {
  for (const atEnd of [false, true]) {
    for (const skipGaps of [false, true]) {
      test(`auto-pause at start=${atStart}, at end=${atEnd}, skip gaps=${skipGaps}: rests where expected`, async ({launch}) => {
        const {ui} = await launchClips(launch, {
          lastPlaybackTime: 0.5,
          // Fast clips keep the walk short; the speed does not change what the rules decide
          settings: {autoPauseAtStart: atStart, autoPauseAtEnd: atEnd, skipGaps, subtitledClipSpeed: 2, gapSpeed: 4}
        });

        const rests: Step[] = [];
        // Not startPlaying: with these speeds Playing lasts about 0.1 s before the first rest, too short to observe reliably
        await press(ui, 'Space');
        let previous: Step | null = null;
        for (let guard = 0; guard < 20; guard++) {
          const rest = await waitForRest(ui, previous);
          if (rest === 'Ended') {
            break;
          }
          rests.push(rest);
          previous = rest;

          // The engine really stopped where the state says: 10 ms before the end of the clip, or 10 ms after its start
          const clip = CLIPS[rest.clip];
          expect(await mpvPaused(ui), `mpv should be paused at ${describeSteps([rest])}`).toBe(true);
          const at = await mpvTime(ui);
          if (rest.state === 'AutoPausedAtEnd') {
            expect(at, `mpv position at the end of clip ${rest.clip}`).toBeGreaterThan(clip.end - 0.08);
            expect(at).toBeLessThan(clip.end + 0.1);
          } else {
            expect(at, `mpv position at the start of clip ${rest.clip}`).toBeGreaterThan(clip.start - 0.02);
            expect(at).toBeLessThan(clip.start + 0.1);
          }

          await press(ui, 'Space');
        }

        expect(describeSteps(rests)).toBe(describeSteps(expectedRests(atStart, atEnd, skipGaps)));

        // With skip-gaps, gap clips are never entered (apart from the one we started in)
        if (skipGaps) {
          const visited = new Set((await stepsSince(ui)).map(s => s.clip));
          const gaps = CLIPS.filter((c, i) => !c.hasSubtitle && i > 0).map(c => c.index);
          for (const g of gaps) {
            expect(visited.has(g), `gap clip ${g} must be skipped, visited: ${[...visited]}`).toBe(false);
          }
        }
      });
    }
  }
}

test('pausing and resuming inside a clip still auto-pauses at its end', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.6), settings: {autoPauseAtEnd: true, subtitledClipSpeed: 0.5}});

  await startPlaying(ui);
  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  await press(ui, 'Space');
  await waitForState(ui, 'Playing');

  const s = await waitForState(ui, 'AutoPausedAtEnd');
  expect(s.currentClipIndex).toBe(3);
  expect(await mpvPaused(ui)).toBe(true);
});

test('switching auto-pause on while a clip is playing takes effect at its end', async ({launch}) => {
  const {ui} = await launchClips(launch, {
    lastPlaybackTime: CLIPS[3].start + 0.05,
    settings: {subtitledClipSpeed: 0.5}
  });

  await startPlaying(ui);
  await setProjectSwitch(ui, 'auto-pause-end', true);

  const s = await waitForState(ui, 'AutoPausedAtEnd', 20_000);
  expect(s.currentClipIndex).toBe(3);
  expect(await mpvPaused(ui)).toBe(true);
});

test('Down arrow continues from an auto-pause at the end of a clip', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, NEAR_END), settings: {autoPauseAtEnd: true}});
  await startPlaying(ui);
  await waitForState(ui, 'AutoPausedAtEnd');

  await press(ui, 'ArrowDown');

  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'moves on to the next clip'}).toBe(4);
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);
  await expectDomSubtitle(ui, CLIPS[4].text);
});

test('turning auto-pause off while auto-paused leaves the player paused by the user', async ({launch}) => {
  // At the end of a clip
  const end = await launchClips(launch, {lastPlaybackTime: inClip(3, NEAR_END), settings: {autoPauseAtEnd: true}});
  await startPlaying(end.ui);
  await waitForState(end.ui, 'AutoPausedAtEnd');
  await setProjectSwitch(end.ui, 'auto-pause-end', false);
  await waitForState(end.ui, 'PausedByUser');
  expect(await mpvPaused(end.ui)).toBe(true);

  // At the start of a clip
  const start = await launchClips(launch, {lastPlaybackTime: inClip(3, NEAR_END), settings: {autoPauseAtStart: true}});
  await startPlaying(start.ui);
  await waitForState(start.ui, 'AutoPausedAtStart', 20_000);
  await setProjectSwitch(start.ui, 'auto-pause-start', false);
  await waitForState(start.ui, 'PausedByUser');

  // And it plays on from there without stopping again at that clip's start
  await press(start.ui, 'Space');
  await waitForState(start.ui, 'Playing');
  await quiet(500);
  expect((await snapshot(start.ui))?.playerState).toBe('Playing');
});
