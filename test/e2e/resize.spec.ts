import {expect, test} from './support/app';
import {seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';
import {baseline} from './support/baseline';
import {getWindowStates, rectContains, rectsClose, withWindows} from './support/windows';

test('setBounds resize: ui follows and the video re-fits inside the placeholder', async ({launch}) => {
  const {app, ui} = await launch({seed: dir => seedProject(dir)});
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

  // After the 250 ms debounce the video window must sit inside the #mpv-placeholder rect (screen coordinates)
  await baseline('video inside placeholder', () => expect.poll(async () => {
    const {ui: uiWin, video} = await getWindowStates(app);
    if (!uiWin || !video?.isVisible) {
      return 'video not visible';
    }
    const r = await ui.locator('#mpv-placeholder').boundingBox();
    if (!r) {
      return 'no placeholder';
    }
    const placeholder = {x: uiWin.contentBounds.x + r.x, y: uiWin.contentBounds.y + r.y, width: r.width, height: r.height};
    return rectContains(placeholder, video.bounds, 3) ? 'ok' : `video ${JSON.stringify(video.bounds)} outside ${JSON.stringify(placeholder)}`;
  }, {timeout: 10_000}).toBe('ok'));

  // Below the 800x600 minimum: recorded, not asserted
  await withWindows(app, ({mainWindow}) => {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({x: b.x, y: b.y, width: 600, height: 400});
  });
  await new Promise(r => setTimeout(r, 500));
  const small = (await getWindowStates(app)).main!.bounds;
  test.info().annotations.push({type: 'baseline', description: `setBounds(600x400) result: ${small.width}x${small.height}`});
});
