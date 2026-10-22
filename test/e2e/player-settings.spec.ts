import {expect, test} from './support/app';
import {CLIPS, inClip} from './support/clips';
import {
  describeSteps, launchClips, markHistory, mpvPaused, mpvString, mpvTime, press, snapshot, startPlaying, stepsSince, waitForState, waitForTime
} from './support/player';
import type {Page} from '@playwright/test';

// Settings and edits that change while the player is running: hardware decoding, and moving the end of a clip.

async function setHardwareAcceleration(ui: Page, value: boolean): Promise<void> {
  await press(ui, 'o');
  const input = ui.locator('#hardware-accel');
  await expect(input).toBeAttached();
  if ((await input.isChecked()) !== value) {
    await input.focus();
    await ui.keyboard.press('Space');
  }
  await expect(input).toBeChecked({checked: value});
  await ui.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await press(ui, 'Escape');
  await expect(input).toHaveCount(0);
}

test('toggling hardware decoding during playback switches the decoder and playback carries on', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: CLIPS[3].start + 0.05, settings: {subtitledClipSpeed: 0.5}});
  expect(await mpvString(ui, 'hwdec')).toBe('no');
  await startPlaying(ui);

  // Opening the settings dialog pauses playback
  await setHardwareAcceleration(ui, true);
  await expect.poll(() => mpvString(ui, 'hwdec'), {message: 'hardware decoding on'}).toBe('auto');
  test.info().annotations.push({type: 'hwdec-current', description: await mpvString(ui, 'hwdec-current')});
  expect((await snapshot(ui))?.playerState).toBe('PausedByUser');

  const before = await mpvTime(ui);
  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
  await waitForTime(ui, t => t > before + 0.3, 'playback continues with hardware decoding');

  await setHardwareAcceleration(ui, false);
  await expect.poll(() => mpvString(ui, 'hwdec'), {message: 'hardware decoding off'}).toBe('no');
  const again = await mpvTime(ui);
  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
  await waitForTime(ui, t => t > again + 0.3, 'playback continues with software decoding');

  await expect(ui.locator('.p-toast-message-error')).toHaveCount(0);
});

test('extending the clip end while auto-paused there: the auto-pause moves to the new end', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.7), settings: {autoPauseAtEnd: true}});
  await startPlaying(ui);
  await waitForState(ui, 'AutoPausedAtEnd');
  const oldEnd = CLIPS[3].end;
  const mark = await markHistory(ui);

  await press(ui, ']');
  // The playhead is no longer at the end of the clip, so this is a plain pause now
  await waitForState(ui, 'PausedByUser');
  expect((await snapshot(ui))?.currentClipIndex).toBe(3);

  await press(ui, 'Space');
  await waitForState(ui, 'AutoPausedAtEnd');
  const steps = await stepsSince(ui, mark);
  expect(steps.map(s => s.state), describeSteps(steps)).toContain('Playing');
  expect(await mpvPaused(ui)).toBe(true);
  expect(await mpvTime(ui), 'mpv should have played on past the old end').toBeGreaterThan(oldEnd + 0.02);
  expect((await snapshot(ui))?.currentClipIndex).toBe(3);

  // Undo puts the end back; the playhead then lies in the following clip
  await press(ui, 'Control+z');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: 'the playhead is in the next clip again'}).toBe(4);
  await waitForState(ui, 'PausedByUser');
});

test('shortening the clip while auto-paused at its end keeps it auto-paused at the new end', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.7), settings: {autoPauseAtEnd: true}});
  await startPlaying(ui);
  await waitForState(ui, 'AutoPausedAtEnd');

  await press(ui, 'Control+]');

  await expect.poll(async () => {
    const s = await snapshot(ui);
    return s?.playerState === 'AutoPausedAtEnd' && s.currentTime < CLIPS[3].end - 0.02;
  }, {message: 'still auto-paused, now at the earlier end'}).toBe(true);
  expect(await mpvPaused(ui)).toBe(true);
  expect(await mpvTime(ui)).toBeLessThan(CLIPS[3].end - 0.02);
  expect((await snapshot(ui))?.currentClipIndex).toBe(3);
});
