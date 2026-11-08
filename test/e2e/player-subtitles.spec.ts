import {expect, test} from './support/app';
import {CLIPS, CLIPS_ASS, CLIPS_SRT, inClip} from './support/clips';
import {
  domSubtitle, expectDomSubtitle, launchClips, markHistory, mpvPaused, mpvSubtitlesVisible, mpvTime, press, seekTo, setSubtitleRenderer,
  snapshot, startPlaying, stepsSince, waitForState, waitForTime
} from './support/player';
import type {Page} from '@playwright/test';

// Showing and hiding subtitles: the subtitle behaviour setting, the C and Down keys, and the two renderers
// (the interactive DOM overlay and mpv's own subtitles), each against the real engine.

const BEHAVIORS = ['DoNothing', 'ForceShow', 'ForceHide'] as const;
type Behavior = typeof BEHAVIORS[number];

/** Whether subtitles are visible at the first subtitled clip on arrival, after pressing C there, and at the next subtitled clip on arrival. */
const EXPECTED: Record<Behavior, { entry: boolean; afterToggle: boolean; nextClip: boolean }> = {
  DoNothing: {entry: true, afterToggle: false, nextClip: false}, // keeps whatever the user chose
  ForceShow: {entry: true, afterToggle: false, nextClip: true}, // C overrides for this clip only
  ForceHide: {entry: false, afterToggle: true, nextClip: false},
};

const domVisible = async (ui: Page): Promise<boolean> => {
  const s = await domSubtitle(ui);
  return s.text !== null && !s.hidden;
};

async function arriveAndPause(ui: Page, clip: number): Promise<void> {
  await press(ui, 'Control+ArrowRight');
  await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: `arrive at clip ${clip}`}).toBe(clip);
  await waitForState(ui, 'Playing');
  await press(ui, 'Space');
  await waitForState(ui, 'PausedByUser');
}

// The renderer choice (interactive or mpv) only exists for ASS subtitles, so mpv's own rendering is run with the ASS fixture
const VARIANTS = {
  'SRT, interactive': {subtitle: CLIPS_SRT, useMpv: false},
  'ASS, interactive': {subtitle: CLIPS_ASS, useMpv: false},
  'ASS, mpv': {subtitle: CLIPS_ASS, useMpv: true},
} as const;

for (const [variant, {subtitle, useMpv}] of Object.entries(VARIANTS)) {
  for (const behavior of BEHAVIORS) {
    test(`${variant} subtitles, behaviour ${behavior}: visibility on arrival, after C, and at the next clip`, async ({launch}) => {
      const {ui} = await launchClips(launch, {
        subtitle,
        lastPlaybackTime: inClip(0, 0.5),
        settings: {subtitleBehavior: behavior, useMpvSubtitles: useMpv}
      });
      const visible = (): Promise<boolean> => useMpv ? mpvSubtitlesVisible(ui) : domVisible(ui);
      const expected = EXPECTED[behavior];

      await arriveAndPause(ui, 1);
      await expect.poll(visible, {message: 'visibility at the first subtitled clip'}).toBe(expected.entry);

      await press(ui, 'c');
      await expect.poll(visible, {message: 'visibility after pressing C'}).toBe(expected.afterToggle);
      expect((await snapshot(ui))?.subtitlesVisible).toBe(expected.afterToggle);

      await arriveAndPause(ui, 3);
      await expect.poll(visible, {message: 'visibility at the next subtitled clip'}).toBe(expected.nextClip);

      // The other renderer never shows anything: the DOM overlay is hidden while mpv draws the subtitles, and the reverse
      if (useMpv) {
        expect((await domSubtitle(ui)).hidden).toBe(true);
      } else {
        expect(await mpvSubtitlesVisible(ui)).toBe(false);
      }
    });
  }
}

for (const [name, subtitle] of [['SRT', CLIPS_SRT], ['ASS', CLIPS_ASS]] as const) {
  test(`the DOM subtitle (${name}) follows the clip: its text in subtitled clips, nothing in gaps`, async ({launch}) => {
    const {ui} = await launchClips(launch, {subtitle, lastPlaybackTime: inClip(0, 0.5)});

    for (const clip of CLIPS) {
      await seekTo(ui, inClip(clip.index, 0.5));
      await expect.poll(async () => (await snapshot(ui))?.currentClipIndex, {message: `at clip ${clip.index}`}).toBe(clip.index);
      await expectDomSubtitle(ui, clip.text);
    }
  });
}

test('Down reveals hidden subtitles first and continues playback on the second press', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: inClip(0, 0.5), settings: {subtitleBehavior: 'ForceHide'}});
  await arriveAndPause(ui, 1);
  await expect.poll(() => domVisible(ui)).toBe(false);

  await press(ui, 'ArrowDown');
  await expect.poll(() => domVisible(ui), {message: 'the first press reveals the subtitle'}).toBe(true);
  expect((await snapshot(ui))?.playerState).toBe('PausedByUser');
  expect(await mpvPaused(ui)).toBe(true);

  await press(ui, 'ArrowDown');
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);
  expect(await domVisible(ui)).toBe(true);
});

test('switching the subtitle renderer applies at once and playback resumes without a seek', async ({launch}) => {
  const {ui} = await launchClips(launch, {subtitle: CLIPS_ASS, lastPlaybackTime: CLIPS[3].start + 0.05, settings: {subtitledClipSpeed: 0.5}});
  await startPlaying(ui);
  await expectDomSubtitle(ui, CLIPS[3].text);
  expect(await mpvSubtitlesVisible(ui)).toBe(false);
  const mark = await markHistory(ui);

  await setSubtitleRenderer(ui, 'mpv');
  await expect.poll(() => mpvSubtitlesVisible(ui), {message: 'mpv draws the subtitles now'}).toBe(true);
  expect((await domSubtitle(ui)).hidden).toBe(true);

  await setSubtitleRenderer(ui, 'interactive');
  await expect.poll(() => mpvSubtitlesVisible(ui), {message: 'mpv stops drawing them again'}).toBe(false);
  await expectDomSubtitle(ui, CLIPS[3].text);

  // The settings drawer pauses playback while it is open and resumes it when it closes; the switch itself never seeks
  const steps = await stepsSince(ui, mark);
  expect(steps.some(s => s.state === 'Transitioning'), JSON.stringify(steps)).toBe(false);
  await waitForState(ui, 'Playing');
  expect(await mpvPaused(ui)).toBe(false);
  await waitForTime(ui, t => t > CLIPS[3].start + 0.3, 'time keeps advancing');
  expect(await mpvTime(ui)).toBeGreaterThan(CLIPS[3].start);
});
