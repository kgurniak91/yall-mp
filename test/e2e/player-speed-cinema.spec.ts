import {expect, test} from './support/app';
import {CLIPS, inClip} from './support/clips';
import {
  describeSteps, dominantSpeed, launchClips, markHistory, mpvPaused, mpvSpeed, mpvTime, press, quiet, seekTo, snapshot, speedSamples, startPlaying,
  startSpeedSampler, stepsSince, waitForState, waitForTime
} from './support/player';
import type {Page} from '@playwright/test';

// Playback speed per clip type, the Shift override, and Cinema mode against Study mode.
// The fixture's defaults here: subtitled clips 1.0x, gaps 2.0x (seed defaults), Shift override 0.5x.

const SUBTITLED_SPEED = 1;
const GAP_SPEED = 2;
const OVERRIDE_SPEED = 0.5;

const expectSpeed = (ui: Page, speed: number, message: string): Promise<void> =>
  expect.poll(() => mpvSpeed(ui), {message}).toBeCloseTo(speed, 5);

test('each clip plays at its own speed: subtitled clips and gaps differ', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});

  for (const clip of CLIPS) {
    await seekTo(ui, inClip(clip.index, 0.5));
    await expect.poll(async () => (await snapshot(ui))?.currentClipIndex).toBe(clip.index);
    await expectSpeed(ui, clip.hasSubtitle ? SUBTITLED_SPEED : GAP_SPEED, `speed in clip ${clip.index} (${clip.hasSubtitle ? 'subtitled' : 'gap'})`);
  }
});

test('the speed changes when playback crosses from a gap into subtitled clips and out into a gap again', async ({launch}) => {
  // Slower clips, and speeds sampled inside the page: a slow runner must not be able to miss a short-lived state
  const slow = 0.5;
  const gap = 1.5;
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(2, 0.3), settings: {subtitledClipSpeed: slow, gapSpeed: gap}});
  await startSpeedSampler(ui);
  const mark = await markHistory(ui);

  await press(ui, 'Space');
  await expect.poll(async () => (await stepsSince(ui, mark)).some(s => s.clip >= 7), {
    message: 'playback reaches the long gap after the subtitled clips',
    timeout: 90_000
  }).toBe(true);
  await quiet(600); // a few samples inside that gap
  const samples = await speedSamples(ui);

  for (const [clip, speed] of [[2, gap], [3, slow], [4, slow], [6, slow], [7, gap]] as const) {
    const seen = dominantSpeed(samples, clip);
    expect(seen, `clip ${clip} should have been sampled: ${JSON.stringify(samples)}`).not.toBeNull();
    expect(seen!.speed, `speed while clip ${clip} was current: ${JSON.stringify(samples[clip])}`).toBeCloseTo(speed, 5);
  }
});

test('holding Shift plays at the override speed and releasing it restores the clip speed', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(7, 0.1)});
  await startPlaying(ui);
  await expectSpeed(ui, GAP_SPEED, 'speed in the long gap');

  await ui.keyboard.down('Shift');
  await expectSpeed(ui, OVERRIDE_SPEED, 'speed while Shift is held');
  await ui.keyboard.up('Shift');
  await expectSpeed(ui, GAP_SPEED, 'speed after Shift is released');
});

test('holding Shift while paused changes the speed without moving or resuming', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.5)});
  const before = await mpvTime(ui);
  const mark = await markHistory(ui);

  await ui.keyboard.down('Shift');
  await expectSpeed(ui, OVERRIDE_SPEED, 'speed while Shift is held');
  await quiet(500); // the player re-seeks to the same spot to flush the audio buffer
  expect(await mpvPaused(ui)).toBe(true);
  expect(Math.abs((await mpvTime(ui)) - before), 'the position must not move').toBeLessThan(0.05);

  await ui.keyboard.up('Shift');
  await expectSpeed(ui, SUBTITLED_SPEED, 'speed after Shift is released');
  expect(await mpvPaused(ui)).toBe(true);
  expect((await stepsSince(ui, mark)).some(s => s.state === 'Playing')).toBe(false);
});

test('Ctrl+. and Ctrl+, change the speed of the current clip type by 0.1', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.5)});

  await press(ui, 'ControlOrMeta+.');
  await expectSpeed(ui, SUBTITLED_SPEED + 0.1, 'faster in a subtitled clip');
  await quiet(250); // longer than the key throttle
  await press(ui, 'ControlOrMeta+,');
  await quiet(250);
  await press(ui, 'ControlOrMeta+,');
  await expectSpeed(ui, SUBTITLED_SPEED - 0.1, 'slower in a subtitled clip');

  // Gaps have their own speed, untouched by the above
  await seekTo(ui, inClip(2, 0.5));
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex).toBe(2);
  await expectSpeed(ui, GAP_SPEED, 'the gap speed is unchanged');
  await press(ui, 'ControlOrMeta+.');
  await expectSpeed(ui, GAP_SPEED + 0.1, 'faster in a gap');
});

test.describe('Cinema mode', () => {
  const cinema = {cinemaModeEnabled: true, cinemaModeSpeed: 1.5};

  test('plays straight through every clip end, at the cinema speed, ignoring auto-pause and skip gaps', async ({launch}) => {
    const {ui} = await launchClips(launch, {
      lastPlaybackTime: inClip(3, 0.5),
      settings: {autoPauseAtStart: true, autoPauseAtEnd: true, skipGaps: true},
      globalSettings: cinema
    });
    const mark = await markHistory(ui);

    await startPlaying(ui);
    await expectSpeed(ui, cinema.cinemaModeSpeed, 'cinema speed in a subtitled clip');
    const s = await waitForState(ui, 'Ended', 30_000);

    const steps = await stepsSince(ui, mark);
    expect(steps.some(x => x.state === 'AutoPausedAtEnd' || x.state === 'AutoPausedAtStart'), describeSteps(steps)).toBe(false);
    // The current clip follows the playhead, gaps included (skip gaps does not apply)
    const visited = new Set(steps.map(x => x.clip));
    expect(visited.has(7), `the long gap must be played, visited: ${[...visited]}`).toBe(true);
    expect(visited.has(8)).toBe(true);
    expect(s.currentClipIndex).toBe(CLIPS.length - 1);
  });

  test('the cinema speed applies in gaps too, and Shift still overrides it', async ({launch}) => {
    const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(7, 0.1), globalSettings: cinema});
    await startPlaying(ui);
    await expectSpeed(ui, cinema.cinemaModeSpeed, 'cinema speed in a gap (study mode would use the gap speed)');

    await ui.keyboard.down('Shift');
    await expectSpeed(ui, OVERRIDE_SPEED, 'Shift overrides the cinema speed');
    await ui.keyboard.up('Shift');
    await expectSpeed(ui, cinema.cinemaModeSpeed, 'back to the cinema speed');
  });

  test('X switches from Cinema to Study mode during a clip: auto-pause and clip speeds apply again', async ({launch}) => {
    const {ui} = await launchClips(launch, {
      lastPlaybackTime: CLIPS[3].start + 0.05,
      settings: {autoPauseAtEnd: true, subtitledClipSpeed: 0.5},
      globalSettings: {cinemaModeEnabled: true, cinemaModeSpeed: 0.5}
    });
    await startPlaying(ui);

    await press(ui, 'x');
    await expectSpeed(ui, 0.5, 'study speed of the subtitled clip');
    const s = await waitForState(ui, 'AutoPausedAtEnd', 20_000);
    expect(s.currentClipIndex).toBe(3);
    expect(await mpvPaused(ui)).toBe(true);
  });

  test('X switches from Study to Cinema mode during a clip: the clip end no longer pauses', async ({launch}) => {
    const {ui} = await launchClips(launch, {
      lastPlaybackTime: CLIPS[3].start + 0.05,
      settings: {autoPauseAtEnd: true, subtitledClipSpeed: 0.5},
      globalSettings: {cinemaModeEnabled: false, cinemaModeSpeed: 1}
    });
    await startPlaying(ui);
    const mark = await markHistory(ui);

    await press(ui, 'x');
    await expectSpeed(ui, 1, 'cinema speed');
    await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'plays on into the next clip', timeout: 20_000}).toBe(4);
    await waitForTime(ui, t => t > CLIPS[4].start + 0.2, 'and keeps playing');

    const steps = await stepsSince(ui, mark);
    expect(steps.some(x => x.state === 'AutoPausedAtEnd'), describeSteps(steps)).toBe(false);
    expect(await mpvPaused(ui)).toBe(false);
  });
});
