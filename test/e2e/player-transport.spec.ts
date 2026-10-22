import {expect, test} from './support/app';
import {baseline} from './support/baseline';
import {CLIPS, inClip} from './support/clips';
import {
  containsInOrder, describeSteps, domSubtitle, expectDomSubtitle, expectVideoShowsClip, launchClips, markHistory, mpvPaused, mpvTime,
  pixelProbesAvailable, press, probeVideoColor, quiet, seekTo, snapshot, startPlaying, stepsSince, waitForState, waitForTime
} from './support/player';

// Transport behaviour of the player against the real playback engine: resume, play/pause, seeking, the end of the file.

test('resumes at the saved position, paused, with that clip on screen', async ({launch}) => {
  const resume = inClip(3, 0.3);
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: resume});

  expect(await mpvTime(ui)).toBeCloseTo(resume, 1);
  expect(await mpvPaused(ui)).toBe(true);
  // The stacked windows on macOS do not show the overlay at the resume position yet; only Windows gates on it
  await baseline('DOM subtitle at the resume position', () => expectDomSubtitle(ui, CLIPS[3].text));

  if (pixelProbesAvailable) {
    // Sample for a second after the spinner went away: the picture must be the resume clip all along, never black or the first clip
    await expectVideoShowsClip(app, ui, 3);
    for (let i = 0; i < 6; i++) {
      const c = await probeVideoColor(app, ui);
      expect(c, `sample ${i}`).not.toBeNull();
      expect(Math.max(c!.r, c!.g, c!.b), `sample ${i} must not be black`).toBeGreaterThan(40);
      await quiet(150);
    }
    await expectVideoShowsClip(app, ui, 3, 1000);
  }
});

test('Space plays and pauses, mpv follows, and time only advances while playing', async ({launch}) => {
  const start = inClip(4, 0.05);
  const {ui} = await launchClips(launch, {lastPlaybackTime: start});

  await startPlaying(ui);
  expect(await mpvPaused(ui)).toBe(false);
  await waitForTime(ui, t => t > start + 0.3, 'time should advance while playing');

  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  expect(await mpvPaused(ui)).toBe(true);
  const frozen = await mpvTime(ui);
  await quiet(700);
  expect(Math.abs((await mpvTime(ui)) - frozen), 'time must not move while paused').toBeLessThan(0.03);

  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
  await waitForTime(ui, t => t > frozen + 0.3, 'time should advance again after resuming');
});

test('arrow keys seek by the seek amount and keep the paused or playing state', async ({launch}) => {
  const start = inClip(3, 0.1); // 4.15: two seconds either way stays inside the fixture
  const {ui} = await launchClips(launch, {lastPlaybackTime: start});

  // Paused: the seek must not start playback
  await press(ui, 'ArrowRight');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'seek forward into clip 4'}).toBe(4);
  let s = await waitForState(ui, 'PausedByUser');
  expect(s.currentTime).toBeCloseTo(start + 2, 0);
  expect(await mpvPaused(ui)).toBe(true);

  await press(ui, 'ArrowLeft');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'seek back into clip 3'}).toBe(3);
  s = await waitForState(ui, 'PausedByUser');
  expect(s.currentTime).toBeCloseTo(start, 0);

  // Playing: the seek keeps playing
  await startPlaying(ui);
  await press(ui, 'ArrowRight');
  await waitForTime(ui, t => t > start + 1.9, 'playback should continue from the new position');
  expect((await waitForState(ui, 'Playing')).currentClipIndex).toBeGreaterThanOrEqual(4);
  expect(await mpvPaused(ui)).toBe(false);
});

test('a paused seek onto a clip boundary resolves to the matching auto-pause state', async ({launch}) => {
  const {ui} = await launchClips(launch, {
    lastPlaybackTime: inClip(3, 0.3),
    settings: {autoPauseAtStart: true, autoPauseAtEnd: true}
  });

  // The positions are the ones auto-pause itself stops at: 10 ms before a clip's end, 10 ms after a clip's start
  await seekTo(ui, CLIPS[3].end - 0.01);
  let s = await waitForState(ui, 'AutoPausedAtEnd');
  expect(s.currentClipIndex).toBe(3);

  await seekTo(ui, CLIPS[4].start + 0.01);
  s = await waitForState(ui, 'AutoPausedAtStart');
  expect(s.currentClipIndex).toBe(4);

  // Anywhere else in a clip it is a plain pause
  await seekTo(ui, inClip(4, 0.5));
  s = await waitForState(ui, 'PausedByUser');
  expect(s.currentClipIndex).toBe(4);
});

test('quick successive seeks end in the right place and state, and never get stuck', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.1)});

  // While playing, the last seek wins and playback carries on from it
  await startPlaying(ui);
  await seekTo(ui, inClip(3, 0.7));
  await seekTo(ui, inClip(6, 0.1));
  await waitForTime(ui, t => t > CLIPS[6].start + 0.5, 'playback should continue from the last seek');
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);

  // While paused, nothing resumes and the last seek wins
  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
  const mark = await markHistory(ui);
  await seekTo(ui, inClip(1, 0.5));
  await seekTo(ui, inClip(2, 0.5));
  await seekTo(ui, inClip(7, 0.1));
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'last seek lands in clip 7'}).toBe(7);
  const s = await waitForState(ui, 'PausedByUser');
  expect(s.currentTime).toBeCloseTo(inClip(7, 0.1), 1);
  expect(await mpvPaused(ui)).toBe(true);
  expect(await mpvTime(ui)).toBeCloseTo(inClip(7, 0.1), 1);
  const steps = await stepsSince(ui, mark);
  expect(steps.some(x => x.state === 'Playing'), `must never resume: ${describeSteps(steps)}`).toBe(false);
});

test('playing to the end of the file ends in Ended with mpv paused at the end', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(9, 0.2)});
  const mark = await markHistory(ui);

  await startPlaying(ui);
  const s = await waitForState(ui, 'Ended', 20_000);

  expect(s.currentClipIndex).toBe(CLIPS.length - 1);
  expect(s.currentTime).toBeCloseTo(15, 0);
  expect(await mpvPaused(ui)).toBe(true);
  expect(containsInOrder(await stepsSince(ui, mark), [{state: 'Playing'}, {state: 'Ended'}])).toBe(true);
});

// Characterisation, not a requirement: this is what the player does today. If it is ever fixed, update the expectations.
test('characterisation: Space at the end of the file shows Playing while mpv stays paused', async ({launch}) => {
  test.skip(process.platform !== 'win32', 'documents what the player does on Windows; other platforms are not characterised yet');
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(9, 0.2)});
  await startPlaying(ui);
  await waitForState(ui, 'Ended', 20_000);

  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
  await quiet(1000);

  const s = await snapshot(ui);
  expect(s?.playerState).toBe('Playing');
  expect(s?.isPaused).toBe(false);
  expect(await mpvPaused(ui), 'mpv ignores the unpause at the end of the file').toBe(true);
  expect(await mpvTime(ui)).toBeGreaterThan(14.9);
  expect((await domSubtitle(ui)).text).toBeNull();

  // Seeking away still works, and because the player believes it was playing, it plays on from there
  await press(ui, 'ArrowLeft');
  await waitForTime(ui, t => t < 14.5, 'the seek should move the playhead back');
});
