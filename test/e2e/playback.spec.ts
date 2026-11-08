import {expect, test} from './support/app';
import {fixture, seedProject} from './support/seed';
import {latestPlayback, playbackHistory, recordPlayback, waitForPlayer} from './support/playback';

test('plays the seeded project and shows the SRT line', async ({launch}) => {
  const {ui} = await launch({seed: dir => seedProject(dir)});
  await waitForPlayer(ui);
  await recordPlayback(ui);

  await ui.keyboard.press('Space');

  await expect.poll(async () => (await latestPlayback(ui))?.playerState, {timeout: 15_000}).toMatch(/Playing|AutoPaused/);

  await expect(ui.locator('.srt-container > span').first()).toContainText('Red line one', {timeout: 15_000});

  await expect.poll(async () => {
    const times = (await playbackHistory(ui)).map(h => h.currentTime);
    return Math.max(...times) - Math.min(...times);
  }, {timeout: 15_000}).toBeGreaterThan(0.5);
});

test('renders ASS subtitles', async ({launch}) => {
  const {ui} = await launch({seed: dir => seedProject(dir, {subtitle: fixture('sample-styled.ass')})});
  await waitForPlayer(ui);
  await recordPlayback(ui);

  await ui.keyboard.press('Space');

  await expect(ui.locator('.ASS-dialogue').first()).toContainText('Red line one', {timeout: 15_000});
});
