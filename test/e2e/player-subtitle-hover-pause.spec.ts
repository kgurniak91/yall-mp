import {expect, test} from './support/app';
import {CLIPS_SRT, inClip} from './support/clips';
import {launchClips, mpvPaused, quiet, snapshot, startPlaying, waitForState} from './support/player';
import type {Page} from '@playwright/test';

// The global setting "pause while the pointer is over the subtitles": pause on entering, resume on leaving, unless the
// user did something with the subtitles in between. Pause and resume are awaited through mpv, never a blind key press.

const SUBTITLE = '.srt-container';

async function launchHover(launch: Parameters<typeof launchClips>[0], enabled: boolean): Promise<Page> {
  const {ui} = await launchClips(launch, {
    subtitle: CLIPS_SRT,
    lastPlaybackTime: inClip(1, 0.1),
    settings: {autoPauseAtEnd: false, subtitledClipSpeed: 0.5},
    globalSettings: {pauseOnSubtitleHover: enabled}
  });
  await startPlaying(ui);
  await expect(ui.locator(SUBTITLE)).toBeVisible();
  return ui;
}

const subtitleBox = async (ui: Page) => (await ui.locator(SUBTITLE).boundingBox())!;

/** A neutral spot well away from the subtitle line, inside the video area. */
async function pointerAway(ui: Page): Promise<void> {
  const box = await subtitleBox(ui);
  await ui.mouse.move(box.x + box.width / 2, Math.max(box.y - 200, 120), {steps: 4});
}

async function pointerOnSubtitle(ui: Page, offsetX?: number): Promise<{ x: number; y: number }> {
  const box = await subtitleBox(ui);
  const x = box.x + (offsetX ?? box.width / 2);
  const y = box.y + box.height / 2;
  await ui.mouse.move(x, y, {steps: 4});
  return {x, y};
}

test('the pointer over the subtitles pauses playback and leaving resumes it', async ({launch}) => {
  const ui = await launchHover(launch, true);
  await pointerAway(ui);
  expect(await mpvPaused(ui)).toBe(false);

  await pointerOnSubtitle(ui);
  await waitForState(ui, 'PausedByUser');
  await expect.poll(() => mpvPaused(ui), {message: 'mpv is paused while hovering'}).toBe(true);

  await pointerAway(ui);
  await waitForState(ui, 'Playing');
  await expect.poll(() => mpvPaused(ui), {message: 'mpv plays again after leaving'}).toBe(false);
});

test('a click on a word keeps playback paused after the pointer leaves', async ({launch}) => {
  const ui = await launchHover(launch, true);
  await pointerAway(ui);
  const {x, y} = await pointerOnSubtitle(ui, 12);
  await waitForState(ui, 'PausedByUser');

  await ui.mouse.down();
  await ui.mouse.up();
  await pointerAway(ui);
  await quiet(700);

  expect((await snapshot(ui))?.playerState).toBe('PausedByUser');
  expect(await mpvPaused(ui), `still paused after clicking at ${x},${y}`).toBe(true);
});

test('playing again with Space while over the subtitles is not undone by another pause', async ({launch}) => {
  const ui = await launchHover(launch, true);
  await pointerAway(ui);
  await pointerOnSubtitle(ui);
  await waitForState(ui, 'PausedByUser');

  await ui.keyboard.press('Space');
  await waitForState(ui, 'Playing');
  const box = await subtitleBox(ui);
  await ui.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2, {steps: 3});
  await quiet(500);

  expect((await snapshot(ui))?.playerState).toBe('Playing');
  expect(await mpvPaused(ui)).toBe(false);
});

test('with the setting off the pointer over the subtitles changes nothing', async ({launch}) => {
  const ui = await launchHover(launch, false);
  await pointerAway(ui);

  await pointerOnSubtitle(ui);
  await quiet(700);

  expect((await snapshot(ui))?.playerState).toBe('Playing');
  expect(await mpvPaused(ui)).toBe(false);
});
