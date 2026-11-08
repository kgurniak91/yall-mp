import {expect, test} from './support/app';
import {CLIPS, inClip} from './support/clips';
import {
  containsInOrder, describeSteps, launchClips, markHistory, mpvPaused, mpvTime, press, quiet, repeatCompletions, snapshot, startPlaying,
  stepsSince, waitForState, waitForTime
} from './support/player';

// Jumping between subtitled clips (Ctrl+Left / Ctrl+Right) and repeating the current clip (Up).

for (const atStart of [false, true]) {
  test(`Ctrl+Right and Ctrl+Left jump between subtitled clips, skipping gaps (auto-pause at start=${atStart})`, async ({launch}) => {
    // Start paused inside the gap between the first and the second subtitled clip
    const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(2, 0.4), settings: {autoPauseAtStart: atStart}});

    // A jump always lands at the start of the clip and then plays, or rests there when auto-pause at start is on
    const landsOn = async (index: number): Promise<void> => {
      await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: `jump to clip ${index}`}).toBe(index);
      await waitForState(ui, atStart ? 'AutoPausedAtStart' : 'Playing');
      expect(await mpvPaused(ui)).toBe(atStart);
      expect(await mpvTime(ui)).toBeGreaterThan(CLIPS[index].start - 0.05);
      expect(await mpvTime(ui)).toBeLessThan(CLIPS[index].start + 0.6);
    };

    await press(ui, 'Control+ArrowRight');
    await landsOn(3);

    await press(ui, 'Control+ArrowRight');
    await landsOn(4); // the adjacent subtitled clip

    await press(ui, 'Control+ArrowLeft');
    await landsOn(3);

    await press(ui, 'Control+ArrowLeft');
    await landsOn(1); // the gap in between is skipped

    // On the first subtitled clip there is nothing before it: the clip restarts
    const mark = await markHistory(ui);
    await quiet(1200);
    await press(ui, 'Control+ArrowLeft');
    await landsOn(1);
    expect(containsInOrder(await stepsSince(ui, mark), [{state: 'Transitioning', clip: 1}]), 'the clip should have been sought').toBe(true);
  });
}

test('Ctrl+Right from a gap jumps to the next subtitled clip, and does nothing after the last one', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(7, 0.5)});

  await press(ui, 'Control+ArrowRight');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex).toBe(8);
  await waitForState(ui, 'Playing');

  // Pause on the last subtitled clip; there is no later one
  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  const mark = await markHistory(ui);
  await press(ui, 'Control+ArrowRight');
  await quiet(700);
  expect(await markHistory(ui), 'no seek, no state change').toBe(mark);
  expect((await snapshot(ui))?.currentClipIndex).toBe(8);
  expect(await mpvPaused(ui)).toBe(true);
});

test('Ctrl+Left from the leading gap does nothing', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  const mark = await markHistory(ui);

  await press(ui, 'Control+ArrowLeft');
  await quiet(700);

  expect(await markHistory(ui)).toBe(mark);
  expect(await mpvPaused(ui)).toBe(true);
});

test('Up repeats the current clip from its start while playing', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.8)});
  await startPlaying(ui);
  const mark = await markHistory(ui);
  const before = await repeatCompletions(ui);

  await press(ui, 'ArrowUp');

  await expect.poll(() => repeatCompletions(ui), {message: 'the repeat seek completes once'}).toBe(before + 1);
  await waitForState(ui, 'Playing');
  await waitForTime(ui, t => t >= CLIPS[3].start && t < inClip(3, 0.6), 'playback restarts at the beginning of the clip');
  const steps = await stepsSince(ui, mark);
  expect(containsInOrder(steps, [{state: 'Transitioning', clip: 3}, {state: 'Playing', clip: 3}]), describeSteps(steps)).toBe(true);
  expect(await repeatCompletions(ui)).toBe(before + 1);
});

test('Up repeats a clip that was paused by the user and plays it', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.8)});
  expect(await mpvPaused(ui)).toBe(true);
  const before = await repeatCompletions(ui);

  await press(ui, 'ArrowUp');

  await expect.poll(() => repeatCompletions(ui)).toBe(before + 1);
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);
  await waitForTime(ui, t => t >= CLIPS[3].start && t < inClip(3, 0.6), 'playback restarts at the beginning of the clip');
});

test('Up after an auto-pause at the end replays the clip and auto-pauses at its end again', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.7), settings: {autoPauseAtEnd: true}});
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
    await press(ui, 'ArrowUp');
    await expect.poll(() => repeatCompletions(ui), {message: `repeat ${i} completes`}).toBe(i);
    await waitForState(ui, 'Playing');
    await waitForTime(ui, t => t >= CLIPS[4].start && t < inClip(4, 0.5), `playback restarted after repeat ${i}`);
    await quiet(600); // longer than the key throttle, and lets the clip move on a little
  }
});
