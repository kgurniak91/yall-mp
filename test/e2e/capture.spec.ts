import * as fs from 'fs';
import * as path from 'path';
import {expect, REPO_ROOT, test} from './support/app';
import {seedProject} from './support/seed';
import {latestPlayback, recordPlayback, waitForPlayer} from './support/playback';
import {getWindowStates} from './support/windows';
import {captureComposited, isGreen, isRed, type Rgb} from './support/capture';

const osName = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
// Elsewhere (and on CI runners without a GPU) the probe values are the baseline we document, not a gate
const hardAssert = process.platform === 'win32' && !process.env['CI'];

test('composited capture shows the video under the UI', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);
  await recordPlayback(ui);
  // Let the frame at the resume position be presented
  await new Promise(r => setTimeout(r, 1000));

  const probePoint = async () => {
    const {ui: uiWin} = await getWindowStates(app);
    const r = (await ui.locator('#mpv-placeholder').boundingBox())!;
    return {x: uiWin!.contentBounds.x + r.x + r.width / 2, y: uiWin!.contentBounds.y + r.y + r.height / 2};
  };

  const artifactsDir = path.join(REPO_ROOT, 'e2e-artifacts');
  fs.mkdirSync(artifactsDir, {recursive: true});

  const redShot = await captureComposited(app, [await probePoint()]);
  await test.info().attach('composited.png', {body: redShot.png, contentType: 'image/png'});
  fs.writeFileSync(path.join(artifactsDir, `${osName}-composited.png`), redShot.png);
  const red: Rgb | null = redShot.colors[0];

  await ui.evaluate(() => (window as any).electronAPI.playbackSeek(4));
  await expect.poll(async () => (await latestPlayback(ui))?.currentTime ?? 0, {timeout: 10_000}).toBeGreaterThan(3.5);
  await new Promise(r => setTimeout(r, 1000));

  const greenShot = await captureComposited(app, [await probePoint()]);
  fs.writeFileSync(path.join(artifactsDir, `${osName}-composited-green.png`), greenShot.png);
  const green: Rgb | null = greenShot.colors[0];

  test.info().annotations.push({type: 'probe', description: `t=1s centre RGB: ${JSON.stringify(red)}, t=4s centre RGB: ${JSON.stringify(green)}`});
  console.log(`[e2e] ${osName} probes: t=1s ${JSON.stringify(red)}, t=4s ${JSON.stringify(green)}`);

  if (hardAssert) {
    expect(isRed(red), `centre at t=1s should be red, got ${JSON.stringify(red)}`).toBe(true);
    expect(isGreen(green), `centre at t=4s should be green, got ${JSON.stringify(green)}`).toBe(true);
  }
});
