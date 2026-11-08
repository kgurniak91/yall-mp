import {expect, test} from './support/app';
import {CLIPS_DURATION} from './support/clips';
import {launchClips, press, seekTo, snapshot} from './support/player';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const clock = (ui: Parameters<typeof seekTo>[0]) => ui.evaluate(() =>
  (document.querySelector('.toolbar-actions-wrapper:last-of-type div.ml-2') as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim());

// After the engine reports the end of the file a late time-pos event (the last frame, 0.03 s before the end) may follow
// and replace the time. About one play in four did that, and the clock then stopped one second short (00:01:29 of 00:01:30).
test('the clock shows the full duration when the file has ended, on every play to the end', async ({launch}) => {
  test.setTimeout(180_000);
  const {ui} = await launchClips(launch, {lastPlaybackTime: CLIPS_DURATION - 2});
  const wanted = `00:00:${CLIPS_DURATION}/00:00:${CLIPS_DURATION}`;
  for (let round = 0; round < 12; round++) {
    await seekTo(ui, CLIPS_DURATION - 2);
    await sleep(800);
    await press(ui, 'Space');
    await expect.poll(async () => (await snapshot(ui))?.playerState, {timeout: 20_000, message: `round ${round}: the file ends`}).toBe('Ended');
    await sleep(600);
    expect(await clock(ui), `round ${round}: the clock at the end of the file`).toBe(wanted);
  }
});

// A seek forward past the end lands on the last frame (0.01 s before the end). The clock cuts off the fraction, so it used to
// read 00:00:14 of 00:00:15 and the seek looked like it did nothing.
test('a seek forward past the end of the file moves the clock to the full duration', async ({launch}) => {
  const {ui} = await launchClips(launch, {lastPlaybackTime: CLIPS_DURATION - 1});
  await seekTo(ui, CLIPS_DURATION - 1);
  await sleep(800);
  expect(await clock(ui), 'the clock before the seek').toBe(`00:00:${CLIPS_DURATION - 1}/00:00:${CLIPS_DURATION}`);
  await press(ui, 'ArrowRight');
  await expect.poll(() => clock(ui), {timeout: 10_000, message: 'the clock after seeking past the end'}).toBe(`00:00:${CLIPS_DURATION}/00:00:${CLIPS_DURATION}`);
  await sleep(1000);
  expect(await clock(ui), 'the clock stays at the end').toBe(`00:00:${CLIPS_DURATION}/00:00:${CLIPS_DURATION}`);
});
