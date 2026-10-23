import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {canvasMatchesContainer, capturePage, isRed, pictureRect} from './support/capture';
import {getWindowStates, rectsClose, withWindows} from './support/windows';

const hardAssert = process.platform === 'win32';

test('setBounds resize: ui follows, the canvas re-fits and the paused picture is redrawn', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);

  await withWindows(app, ({mainWindow}) => {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({x: b.x, y: b.y, width: 1000, height: 700});
  });

  await expect.poll(async () => {
    const {main, ui: uiWin} = await getWindowStates(app);
    return !!main && !!uiWin && rectsClose(main.bounds, uiWin.bounds, 2) && Math.abs(main.bounds.width - 1000) <= 2;
  }, {timeout: 10_000}).toBe(true);

  await expect.poll(() => ui.evaluate(() => window.innerWidth)).toBeGreaterThan(900);

  // After the settle time the backing store equals the container size in device pixels
  await expect.poll(async () => (await canvasMatchesContainer(ui)).ok, {timeout: 10_000, message: JSON.stringify(await canvasMatchesContainer(ui))}).toBe(true);
  const box = (await ui.locator('#video-surface').boundingBox())!;
  const container = (await ui.locator('#video-container').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(container.x - 1);
  expect(box.width).toBeLessThanOrEqual(container.width + 1);
  expect(box.height).toBeLessThanOrEqual(container.height + 1);

  // The video is paused at the resume position: the picture at the new size has to come from a redraw
  const picture = await pictureRect(ui);
  await expect.poll(async () => {
    const colour = (await capturePage(app, ui)).colorAt(picture.x + picture.width / 2, picture.y + picture.height / 2);
    return isRed(colour);
  }, {timeout: 10_000, message: 'the paused picture should be redrawn at the new size'}).toBe(true).catch(e => {
    if (hardAssert) {
      throw e;
    }
  });

  // Below the 800x600 minimum: recorded, not asserted
  await withWindows(app, ({mainWindow}) => {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({x: b.x, y: b.y, width: 600, height: 400});
  });
  await new Promise(r => setTimeout(r, 500));
  const small = (await getWindowStates(app)).main!.bounds;
  test.info().annotations.push({type: 'baseline', description: `setBounds(600x400) result: ${small.width}x${small.height}`});
});

test('resize stress: no draw errors, no send failures, the slots come back', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir, {lastPlaybackTime: 1.0})});
  await waitForPlayer(ui);

  for (let i = 0; i < 40; i++) {
    const width = 900 + ((i * 53) % 400);
    const height = 650 + ((i * 37) % 300);
    await app.evaluate((_electron, size) => {
      const win = (globalThis as any).__yallE2E.getWindows().mainWindow;
      const b = win.getBounds();
      win.setBounds({x: b.x, y: b.y, width: size.width, height: size.height});
    }, {width, height});
    await new Promise(r => setTimeout(r, 25));
  }

  await expect.poll(async () => (await canvasMatchesContainer(ui)).ok, {timeout: 10_000}).toBe(true);
  await new Promise(r => setTimeout(r, 500));

  const surface = await ui.evaluate(() => (window as any).__yallVideoStats);
  const sender = await app.evaluate(() => (globalThis as any).__yallE2E.getVideoStats());
  test.info().annotations.push({type: 'probe', description: `surface ${JSON.stringify(surface)}; sender backend ${sender?.backend}, sent ${sender?.sent}, inFlight ${sender?.addon?.inFlight}, reclaimed ${sender?.addon?.reclaimed}`});
  expect(surface.errors).toBe(0);
  expect(sender.sendFailures).toBe(0);
  // paused: the kept frame holds one slot, one more may still be on its way
  expect(sender.addon.inFlight).toBeLessThanOrEqual(2);
  expect(sender.addon.reclaimed).toBe(0);
});
