import {expect, test} from './support/app';
import {inClip} from './support/clips';
import {launchClips, press, VIDEO_AREA} from './support/player';
import type {Page} from '@playwright/test';

// Hiding the whole timeline with T: the video area grows, and the waveform is drawn again at full width when it returns.

const videoHeight = async (ui: Page): Promise<number> => (await ui.locator(VIDEO_AREA).first().boundingBox())?.height ?? 0;
// wavesurfer draws inside a shadow root; the scrolling wrapper is as wide as the whole waveform at the current zoom
const waveformWidth = (ui: Page): Promise<number> => ui.evaluate(() => {
  const host = document.querySelector('#timeline > div');
  return host?.shadowRoot?.querySelector('.wrapper')?.getBoundingClientRect().width ?? 0;
});

test('T hides the timeline and the video grows, T again brings the waveform back', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5)});
  const timeline = ui.locator('.timeline-area');
  await expect(timeline).toBeVisible();
  await expect.poll(() => waveformWidth(ui), {message: 'the waveform is drawn'}).toBeGreaterThan(0);
  const shown = await videoHeight(ui);

  await press(ui, 't');
  await expect(timeline).toBeHidden();
  await expect.poll(() => videoHeight(ui), {message: 'the video area grows'}).toBeGreaterThan(shown);

  await press(ui, 't');
  await expect(timeline).toBeVisible();
  await expect.poll(() => waveformWidth(ui), {message: 'the waveform has a width again'}).toBeGreaterThan(0);
  await expect.poll(() => videoHeight(ui), {message: 'the video area shrinks back'}).toBe(shown);
});

test('a timeline hidden in the saved settings starts hidden and is drawn when shown', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5), globalSettings: {hideTimeline: true}});
  await expect(ui.locator('.timeline-area')).toBeHidden();

  await press(ui, 't');
  await expect(ui.locator('.timeline-area')).toBeVisible();
  await expect.poll(() => waveformWidth(ui), {message: 'the waveform is drawn at the container width'}).toBeGreaterThan(100);
});
