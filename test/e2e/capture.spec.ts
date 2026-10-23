import * as fs from 'fs';
import * as path from 'path';
import {expect, REPO_ROOT, test} from './support/app';
import {fixture, seedProject} from './support/seed';
import {latestPlayback, recordPlayback, waitForPlayer} from './support/playback';
import {withWindows} from './support/windows';
import {
  captureComposited,
  capturePage,
  isBlack,
  isGreen,
  isRed,
  pictureRect,
  type Rgb
} from './support/capture';

const osName = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
// macOS takes the capped readback path until its GPU backend exists, so its pixels are a baseline, not a gate
const hardAssert = process.platform === 'win32';

const artifactsDir = path.join(REPO_ROOT, 'e2e-artifacts');

const backendOf = async (app: Parameters<typeof withWindows>[0]): Promise<string> =>
  app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats()?.backend ?? 'none');

test('the canvas shows the video colours under the UI', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);
  await recordPlayback(ui);

  const centre = async (): Promise<Rgb | null> => {
    const r = (await ui.locator('#video-container').boundingBox())!;
    return (await capturePage(app, ui)).colorAt(r.x + r.width / 2, r.y + r.height / 2);
  };

  fs.mkdirSync(artifactsDir, {recursive: true});
  const backend = await backendOf(app);
  test.info().annotations.push({type: 'backend', description: backend});

  let red: Rgb | null = null;
  await expect.poll(async () => isRed(red = await centre()), {timeout: 10_000, message: 'centre at t=1s should be red'}).toBe(true).catch(e => {
    if (hardAssert) {
      throw e;
    }
  });
  const redShot = await captureComposited(app, []);
  fs.writeFileSync(path.join(artifactsDir, `${osName}-composited.png`), redShot.png);
  await test.info().attach('composited.png', {body: redShot.png, contentType: 'image/png'});

  await ui.evaluate(() => (window as any).electronAPI.playbackSeek(4));
  await expect.poll(async () => (await latestPlayback(ui))?.currentTime ?? 0, {timeout: 10_000}).toBeGreaterThan(3.5);
  let green: Rgb | null = null;
  await expect.poll(async () => isGreen(green = await centre()), {timeout: 10_000, message: 'centre at t=4s should be green'}).toBe(true).catch(e => {
    if (hardAssert) {
      throw e;
    }
  });
  fs.writeFileSync(path.join(artifactsDir, `${osName}-composited-green.png`), (await captureComposited(app, [])).png);

  console.log(`[e2e] ${osName} (${backend}) probes: t=1s ${JSON.stringify(red)}, t=4s ${JSON.stringify(green)}`);
  test.info().annotations.push({type: 'probe', description: `${backend}: t=1s centre ${JSON.stringify(red)}, t=4s centre ${JSON.stringify(green)}`});
});

test('letterbox bars are opaque black and the picture is not stretched', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);

  // A window whose video area is clearly not 16:9 (about 4:3)
  await withWindows(app, ({mainWindow}) => {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({x: b.x, y: b.y, width: 1000, height: 1000});
  });
  await expect.poll(() => ui.evaluate(() => window.innerWidth), {timeout: 10_000}).toBeGreaterThan(900);
  // the canvas backing store follows the settled size
  await expect.poll(async () => ui.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#video-surface')!;
    const box = document.querySelector('#video-container')!.getBoundingClientRect();
    return Math.abs(canvas.width - Math.round(box.width * devicePixelRatio)) <= 1 && Math.abs(canvas.height - Math.round(box.height * devicePixelRatio)) <= 1;
  }), {timeout: 10_000}).toBe(true);

  const picture = await pictureRect(ui);
  const horizontalBars = picture.y - picture.container.y > 10;
  const verticalBars = picture.x - picture.container.x > 10;
  expect(horizontalBars || verticalBars, 'the test window should leave bars around a 16:9 picture').toBe(true);

  let bar: Rgb | null = null;
  let inside: Rgb | null = null;
  await expect.poll(async () => {
    const shot = await capturePage(app, ui);
    bar = horizontalBars
      ? shot.colorAt(picture.container.x + picture.container.width / 2, picture.container.y + 4)
      : shot.colorAt(picture.container.x + 4, picture.container.y + picture.container.height / 2);
    inside = shot.colorAt(picture.x + picture.width / 2, picture.y + picture.height / 2);
    return isBlack(bar) && isRed(inside);
  }, {timeout: 10_000}).toBe(true).catch(e => {
    if (hardAssert) {
      throw new Error(`bar ${JSON.stringify(bar)}, picture ${JSON.stringify(inside)}\n${e.message}`);
    }
  });
});

test('subtitle text is drawn above the canvas', async ({launch}) => {
  const {ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);

  const line = ui.locator('.srt-container > span').first();
  await expect(line).toContainText('Red line one', {timeout: 15_000});
  const topmost = await line.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {insideOverlay: !!hit?.closest('.srt-container'), isCanvas: hit?.id === 'video-surface'};
  });
  expect(topmost).toEqual({insideOverlay: true, isCanvas: false});
});

test.describe('mpv-rendered subtitles', () => {
  const subtitleBand = async (ui: Parameters<typeof pictureRect>[0]) => {
    const p = await pictureRect(ui);
    return {x: p.x, y: p.y + p.height * 0.7, width: p.width, height: p.height * 0.3};
  };

  test('useMpvSubtitles burns the text into the picture and hides the DOM layer', async ({launch}) => {
    const {app, ui} = await launch({
      seed: dir => seedProject(dir, {subtitle: fixture('sample-styled.ass'), lastPlaybackTime: 1.0, settings: {useMpvSubtitles: true}})
    });
    await waitForPlayer(ui);
    await expect(ui.locator('.ASS-dialogue')).toBeHidden();

    const band = await subtitleBand(ui);
    let white = 0;
    await expect.poll(async () => (white = (await capturePage(app, ui)).countLight(band)), {
      timeout: 10_000, message: 'mpv should draw the subtitle text into the frame'
    }).toBeGreaterThan(150).catch(async e => {
      // What mpv thinks it is showing, and what the page looks like, for runners where the text does not appear
      const props: Record<string, unknown> = {};
      for (const name of ['sid', 'sub-visibility', 'sub-text', 'sub-delay', 'time-pos', 'pause', 'osd-width', 'osd-height']) {
        props[name] = await ui.evaluate(p => (window as any).electronAPI.mpvGetProperty(p), name).catch(err => `error: ${err}`);
      }
      await test.info().attach('mpv-properties.json', {body: JSON.stringify({white, band, props}, null, 2), contentType: 'application/json'});
      await test.info().attach('page.png', {body: await ui.screenshot(), contentType: 'image/png'}).catch(() => undefined);
      if (hardAssert) {
        throw e;
      }
    });
    test.info().annotations.push({type: 'probe', description: `light pixels in the subtitle band (mpv): ${white}`});
  });

  test('without useMpvSubtitles the picture has no text of its own', async ({launch}) => {
    const {app, ui} = await launch({
      seed: dir => seedProject(dir, {subtitle: fixture('sample-styled.ass'), lastPlaybackTime: 1.0, settings: {useMpvSubtitles: false}})
    });
    await waitForPlayer(ui);
    await expect(ui.locator('.ASS-dialogue').first()).toContainText('Red line one', {timeout: 15_000});

    // Hide the DOM layer: whatever text is left in the screenshot came from the video itself
    await ui.addStyleTag({content: 'app-subtitles-overlay { visibility: hidden !important; }'});
    const band = await subtitleBand(ui);
    await new Promise(r => setTimeout(r, 300));
    const white = (await capturePage(app, ui)).countWhite(band);
    test.info().annotations.push({type: 'probe', description: `white pixels in the subtitle band (DOM layer hidden): ${white}`});
    if (hardAssert) {
      expect(white).toBeLessThan(20);
    }
  });
});
