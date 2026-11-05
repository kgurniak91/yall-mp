import {expect, test} from './support/app';
import {CLIPS, inClip, NEAR_END} from './support/clips';
import {playbackHistory, type PlaybackSnapshot} from './support/playback';
import {
  changesSince, containsInOrder, describeSteps, launchClips, markHistory, mpvPaused, mpvTime, press, quiet, repeatCompletions, snapshot, startPlaying,
  stepsSince, waitForState, waitForTimeSince
} from './support/player';

// Jumping between subtitled clips (Ctrl+Left / Ctrl+Right) and repeating the current clip (Up).

// The clip plays on while the checks run; a VM needs more time than a desktop
const slowHost = process.platform === 'linux' || process.platform === 'darwin';
const landingSlack = slowHost ? 1.5 : 0.6;
const restartSlack = slowHost ? 2 : 0.5;

for (const atStart of [false, true]) {
  test(`Ctrl+Right and Ctrl+Left jump between subtitled clips, skipping gaps (auto-pause at start=${atStart})`, async ({launch}) => {
    // Start paused inside the gap between the first and the second subtitled clip
    const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(2, 0.4), settings: {autoPauseAtStart: atStart}});

    const wanted = atStart ? 'AutoPausedAtStart' : 'Playing';
    // A jump always lands at the start of the clip and then plays, or rests there when auto-pause at start is on.
    // Where it landed is read from the first update in the new clip, not from the live position: the clip plays on
    // while the poll runs, so a late read of the live position would judge the playback rather than the landing.
    const landsOn = async (index: number, mark: number): Promise<void> => {
      const landing = async (): Promise<PlaybackSnapshot | undefined> => {
        const history = await playbackHistory(ui);
        let departed = mark === 0; // no update before the mark: nothing to depart from
        for (const s of history.slice(Math.max(0, mark - 1))) {
          if (s.currentClipIndex !== index || s.playerState !== wanted) {
            departed = true;
          } else if (departed) {
            return s;
          }
        }
        return undefined;
      };
      await expect.poll(async () => (await landing()) !== undefined, {message: `jump to clip ${index} (${wanted})`}).toBe(true);
      const landedAt = (await landing())!.currentTime;
      expect(landedAt, `landing time in clip ${index}`).toBeGreaterThan(CLIPS[index].start - 0.05);
      expect(landedAt, `landing time in clip ${index}`).toBeLessThan(CLIPS[index].start + landingSlack);
      if (atStart) {
        // It rests at the start, so the live position must be there too
        expect(await mpvPaused(ui)).toBe(true);
        expect(await mpvTime(ui)).toBeGreaterThan(CLIPS[index].start - 0.05);
        expect(await mpvTime(ui)).toBeLessThan(CLIPS[index].start + landingSlack);
      }
    };
    const jump = async (key: string, index: number): Promise<void> => {
      const mark = await markHistory(ui);
      await press(ui, key);
      await landsOn(index, mark);
    };

    await jump('ControlOrMeta+ArrowRight', 3);
    await jump('ControlOrMeta+ArrowRight', 4); // the adjacent subtitled clip
    await jump('ControlOrMeta+ArrowLeft', 3);
    await jump('ControlOrMeta+ArrowLeft', 1); // the gap in between is skipped

    // On the first subtitled clip there is nothing before it: the clip restarts
    await quiet(1200);
    const mark = await markHistory(ui);
    await press(ui, 'ControlOrMeta+ArrowLeft');
    // The clip index does not change, so the seek itself is what to wait for before judging where the clip landed
    await expect.poll(async () => containsInOrder(await stepsSince(ui, mark), [{state: 'Transitioning', clip: 1}]), {message: 'the clip should have been sought'}).toBe(true);
    await landsOn(1, mark);
  });
}

test('Ctrl+Right from a gap jumps to the next subtitled clip, and does nothing after the last one', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(7, 0.5)});

  await press(ui, 'ControlOrMeta+ArrowRight');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex).toBe(8);
  await waitForState(ui, 'Playing');

  // Pause on the last subtitled clip; there is no later one
  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  // The state turns PausedByUser when the key is handled; the last frame before mpv stops can still move the playhead
  // a little after that (macOS reports the pause late), so let it settle before taking the baseline
  await expect.poll(() => mpvPaused(ui)).toBe(true);
  await quiet(400);
  const mark = await markHistory(ui);
  const timeBefore = await mpvTime(ui);
  await press(ui, 'ControlOrMeta+ArrowRight');
  await quiet(700);
  expect(await changesSince(ui, mark), 'no seek, no state change').toEqual([]);
  expect((await snapshot(ui))?.currentClipIndex).toBe(8);
  expect(await mpvPaused(ui)).toBe(true);
  expect(Math.abs(await mpvTime(ui) - timeBefore), 'the playhead stays where it was').toBeLessThan(0.05);
});

test('Ctrl+Left from the leading gap does nothing', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  const mark = await markHistory(ui);
  const timeBefore = await mpvTime(ui);

  await press(ui, 'ControlOrMeta+ArrowLeft');
  await quiet(700);

  expect(await changesSince(ui, mark), 'no seek, no state change').toEqual([]);
  expect(await mpvPaused(ui)).toBe(true);
  expect(Math.abs(await mpvTime(ui) - timeBefore), 'the playhead stays where it was').toBeLessThan(0.05);
});

test('Up repeats the current clip from its start while playing', async ({launch}) => {
  // Early in the clip: the key must land well before playback runs on into the adjacent clip
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.1)});
  await startPlaying(ui);
  const mark = await markHistory(ui);
  const before = await repeatCompletions(ui);

  await press(ui, 'ArrowUp');

  await expect.poll(() => repeatCompletions(ui), {message: 'the repeat seek completes once'}).toBe(before + 1);
  await waitForState(ui, 'Playing');
  await waitForTimeSince(ui, mark, t => t >= CLIPS[3].start && t < inClip(3, 0.6), 'playback restarts at the beginning of the clip');
  const steps = await stepsSince(ui, mark);
  expect(containsInOrder(steps, [{state: 'Transitioning', clip: 3}, {state: 'Playing', clip: 3}]), describeSteps(steps)).toBe(true);
  expect(await repeatCompletions(ui)).toBe(before + 1);
});

test('Up repeats a clip that was paused by the user and plays it', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.8)});
  expect(await mpvPaused(ui)).toBe(true);
  const before = await repeatCompletions(ui);
  const mark = await markHistory(ui);

  await press(ui, 'ArrowUp');

  await expect.poll(() => repeatCompletions(ui)).toBe(before + 1);
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);
  await waitForTimeSince(ui, mark, t => t >= CLIPS[3].start && t < inClip(3, 0.6), 'playback restarts at the beginning of the clip');
});

test('Up after an auto-pause at the end replays the clip and auto-pauses at its end again', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, NEAR_END), settings: {autoPauseAtEnd: true}});
  await startPlaying(ui);
  await waitForState(ui, 'AutoPausedAtEnd');
  const mark = await markHistory(ui);

  await press(ui, 'ArrowUp');

  await expect.poll(async () => containsInOrder(await stepsSince(ui, mark), [
    {state: 'Transitioning', clip: 3}, {state: 'Playing', clip: 3}, {state: 'AutoPausedAtEnd', clip: 3}
  ]), {message: 'replays, then rests at the end of the same clip again', timeout: 20_000}).toBe(true);
  expect(await mpvPaused(ui)).toBe(true);
  expect(await mpvTime(ui)).toBeGreaterThan(CLIPS[3].end - 0.08);
});

test('repeating twice in a row restarts the clip each time', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(4, 0.7)});
  await startPlaying(ui);

  for (let i = 1; i <= 2; i++) {
    const mark = await markHistory(ui);
    await press(ui, 'ArrowUp');
    await expect.poll(() => repeatCompletions(ui), {message: `repeat ${i} completes`}).toBe(i);
    await waitForState(ui, 'Playing');
    await waitForTimeSince(ui, mark, t => t >= CLIPS[4].start && t < inClip(4, restartSlack), `playback restarted after repeat ${i}`);
    await quiet(600); // longer than the key throttle, and lets the clip move on a little
  }
});
