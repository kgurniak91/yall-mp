import {expect, test} from './support/app';
import {CLIPS_ASS, inClip} from './support/clips';
import {
  expectVideoShowsClip, launchClips, mpvSubtitlesVisible, pixelProbesAvailable, press, seekTo, setSubtitleRenderer, startPlaying,
  whitePixelsInSubtitleBand
} from './support/player';

// What is actually on screen. These read pixels, so they need a real GPU and a real screen (the hosted CI runners have neither).
test.skip(!pixelProbesAvailable, 'pixel probes need a real GPU and screen');

test('a paused seek draws the picture of the clip it lands in', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});

  for (const index of [3, 1, 6, 9, 0, 8, 4, 2, 7]) {
    await seekTo(ui, inClip(index, 0.5));
    await expectVideoShowsClip(app, ui, index);
  }
});

test('the picture follows the clips while playing', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {lastPlaybackTime: inClip(3, 0.5)});
  await expectVideoShowsClip(app, ui, 3);

  await startPlaying(ui);
  await expectVideoShowsClip(app, ui, 4, 10_000);
});

test('mpv draws the subtitle text itself in mpv mode, and stops when the subtitles are hidden', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {
    subtitle: CLIPS_ASS,
    lastPlaybackTime: inClip(3, 0.5),
    settings: {useMpvSubtitles: true}
  });
  await expect.poll(() => mpvSubtitlesVisible(ui)).toBe(true);

  const shown = await whitePixelsInSubtitleBand(app, ui);
  console.log(`[e2e] white pixels in the subtitle band, mpv mode shown: ${shown}`);
  expect(shown, 'text pixels with mpv subtitles shown').toBeGreaterThan(10);

  await press(ui, 'c');
  await expect.poll(() => mpvSubtitlesVisible(ui)).toBe(false);
  const hidden = await whitePixelsInSubtitleBand(app, ui);
  console.log(`[e2e] white pixels in the subtitle band, mpv mode hidden: ${hidden}`);
  expect(hidden, 'text pixels with mpv subtitles hidden').toBeLessThan(3);
});

test('in interactive mode the text comes from the DOM overlay and mpv draws none', async ({launch}) => {
  const {app, ui} = await launchClips(launch, {subtitle: CLIPS_ASS, lastPlaybackTime: inClip(3, 0.5)});
  expect(await mpvSubtitlesVisible(ui)).toBe(false);

  await expect.poll(() => whitePixelsInSubtitleBand(app, ui), {message: 'DOM overlay text on screen'}).toBeGreaterThan(10);
  const shown = await whitePixelsInSubtitleBand(app, ui);
  console.log(`[e2e] white pixels in the subtitle band, interactive shown: ${shown}`);

  await press(ui, 'c');
  await expect.poll(() => whitePixelsInSubtitleBand(app, ui), {message: 'no text once hidden'}).toBeLessThan(3);

  // Both renderers drawing the same text would show as a doubled subtitle; switching to mpv hands the text over
  await press(ui, 'c');
  await setSubtitleRenderer(ui, 'mpv');
  await expect.poll(() => mpvSubtitlesVisible(ui)).toBe(true);
  await expect.poll(() => whitePixelsInSubtitleBand(app, ui), {message: 'mpv text on screen'}).toBeGreaterThan(10);
});
