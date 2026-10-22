import {expect, type ElectronApplication, type Locator, type Page} from '@playwright/test';
import type {LaunchedApp, LaunchOptions} from './app';
import {captureComposited, type Rgb} from './capture';
import {CLIPS, clipsSeed, nearestClip} from './clips';
import {latestPlayback, playbackHistory, recordPlayback, waitForPlayer, type PlaybackSnapshot} from './playback';
import {seedProject, type SeedOptions} from './seed';

// Everything here works on the stacked-window player (the video is a separate mpv window, #mpv-placeholder) and on
// the single-window player (the video is a canvas in #video-container), so the same specs run on both.

export type PlayerStateName =
  'Idle' | 'Playing' | 'PausedByUser' | 'PausedBySystem' | 'AutoPausedAtStart' | 'AutoPausedAtEnd' | 'Seeking' | 'Transitioning' | 'Ended';

const CLIP_COLORS = CLIPS.map(c => c.color);

export const VIDEO_AREA = '#video-container, #mpv-placeholder';

/** Pixel probes need a real GPU and a real screen: the hosted runners render the composited capture white. */
export const pixelProbesAvailable = process.platform === 'win32' && !process.env['CI'];

type LaunchFn = (opts?: LaunchOptions) => Promise<LaunchedApp>;

/** Opens the clips fixture straight in the player, waits for the first frame and starts recording playback updates. */
export async function launchClips(launch: LaunchFn, opts: SeedOptions = {}, extra: Omit<LaunchOptions, 'seed'> = {}): Promise<LaunchedApp> {
  const launched = await launch({...extra, seed: dir => seedProject(dir, clipsSeed(opts))});
  await waitForPlayer(launched.ui);
  await recordPlayback(launched.ui);
  await launched.ui.evaluate(() => {
    const w = window as any;
    w.__e2eRepeatDone = 0;
    w.electronAPI.onRepeatSeekCompleted(() => w.__e2eRepeatDone++);
  });
  return launched;
}

/** How many times the repeat seek has completed since the project opened. */
export const repeatCompletions = (ui: Page): Promise<number> => ui.evaluate(() => (window as any).__e2eRepeatDone ?? 0);

// --- Playback state

export const snapshot = (ui: Page): Promise<PlaybackSnapshot | undefined> => latestPlayback(ui);

export async function waitForState(ui: Page, states: PlayerStateName | PlayerStateName[], timeout = 15_000): Promise<PlaybackSnapshot> {
  const wanted = Array.isArray(states) ? states : [states];
  await expect.poll(async () => (await latestPlayback(ui))?.playerState, {
    timeout,
    message: `player state should become ${wanted.join(' or ')}`
  }).toMatch(new RegExp(`^(${wanted.join('|')})$`));
  return (await latestPlayback(ui))!;
}

export async function waitForTime(ui: Page, predicate: (time: number) => boolean, message: string, timeout = 15_000): Promise<void> {
  await expect.poll(async () => predicate((await latestPlayback(ui))?.currentTime ?? -1), {timeout, message}).toBe(true);
}

/** Marks the current end of the recorded updates; `stepsSince` then returns what happened after this point. */
export const markHistory = async (ui: Page): Promise<number> => (await playbackHistory(ui)).length;

export interface Step {
  state: string;
  clip: number;
}

/** The distinct (state, clip index) steps since the mark; consecutive repeats (time-pos ticks) are collapsed. */
export async function stepsSince(ui: Page, mark = 0): Promise<Step[]> {
  const steps: Step[] = [];
  for (const s of (await playbackHistory(ui)).slice(mark)) {
    const last = steps[steps.length - 1];
    if (!last || last.state !== s.playerState || last.clip !== s.currentClipIndex) {
      steps.push({state: s.playerState, clip: s.currentClipIndex});
    }
  }
  return steps;
}

/** True when `wanted` occurs in `steps` in this order (other steps, such as Transitioning, may be in between). A step without `clip` matches any clip. */
export function containsInOrder(steps: Step[], wanted: { state: PlayerStateName; clip?: number }[]): boolean {
  let at = 0;
  for (const w of wanted) {
    const found = steps.findIndex((s, i) => i >= at && s.state === w.state && (w.clip === undefined || s.clip === w.clip));
    if (found === -1) {
      return false;
    }
    at = found + 1;
  }
  return true;
}

export const describeSteps = (steps: Step[]): string => steps.map(s => `${s.state}@${s.clip}`).join(' > ');

// --- mpv as an oracle (works on both engines through mpv:getProperty)

export const mpvProp = (ui: Page, name: string): Promise<any> => ui.evaluate(p => (window as any).electronAPI.mpvGetProperty(p), name);

const asBool = (v: unknown): boolean => v === true || v === 'yes';

/** A string or list property as one string: node-mpv reports `hwdec` as a list, libmpv may report a plain string. */
export const mpvString = async (ui: Page, name: string): Promise<string> => {
  const v = await mpvProp(ui, name);
  return Array.isArray(v) ? v.join(',') : String(v);
};

export const mpvPaused = async (ui: Page): Promise<boolean> => asBool(await mpvProp(ui, 'pause'));
export const mpvSpeed = async (ui: Page): Promise<number> => Number(await mpvProp(ui, 'speed'));
export const mpvTime = async (ui: Page): Promise<number> => Number(await mpvProp(ui, 'time-pos'));
export const mpvSubtitlesVisible = async (ui: Page): Promise<boolean> => asBool(await mpvProp(ui, 'sub-visibility'));

// --- Input (the real keyboard shortcuts, as the user presses them)

export const press = (ui: Page, key: string): Promise<void> => ui.keyboard.press(key);

export async function startPlaying(ui: Page): Promise<void> {
  await press(ui, 'Space');
  await waitForState(ui, 'Playing');
}

/**
 * Positions the playhead exactly, through the same IPC the timeline click uses. The arrow keys move by the seek amount
 * (2 s) from wherever playback is, which is too imprecise to set up a scenario; the keys themselves are covered in the specs.
 */
export const seekTo = (ui: Page, time: number, isNavigation = false): Promise<void> =>
  ui.evaluate(([t, nav]) => (window as any).electronAPI.playbackSeek(t, nav), [time, isNavigation] as const);

// --- Settings panels

/** Sets an on/off switch of the project settings drawer (auto-pause, skip gaps, ...) and closes the drawer again. */
export async function setProjectSwitch(ui: Page, inputId: string, value: boolean): Promise<void> {
  await press(ui, 'p');
  const input = ui.locator(`#${inputId}`);
  await expect(input).toBeAttached();
  await toggleNativeInput(ui, input, value);
  await closeProjectSettings(ui);
}

/**
 * Toggles a PrimeNG switch or radio through the keyboard (focus, Space). Its native input is hidden inside the widget, and
 * mouse clicks near the window edge hit the stacked window's resize strips on the mpv-window player.
 */
async function toggleNativeInput(ui: Page, input: Locator, value: boolean): Promise<void> {
  if ((await input.isChecked()) !== value) {
    await input.focus();
    await ui.keyboard.press('Space');
  }
  await expect(input).toBeChecked({checked: value});
}

/** Picks the subtitle renderer in the project settings drawer and closes it. */
export async function setSubtitleRenderer(ui: Page, renderer: 'interactive' | 'mpv'): Promise<void> {
  await press(ui, 'p');
  const radio = ui.locator(`#renderer-${renderer}`);
  await expect(radio).toBeAttached();
  await toggleNativeInput(ui, radio, true);
  await closeProjectSettings(ui);
}

export async function closeProjectSettings(ui: Page): Promise<void> {
  // Shortcuts ignore key presses while an input has focus
  await ui.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await press(ui, 'p');
  await expect(ui.locator('#auto-pause-end')).toHaveCount(0);
}

// --- Navigation

export async function goToProjectList(ui: Page): Promise<void> {
  await ui.locator('.menu-button-wrapper button').click();
  await ui.getByText('List of projects').click();
  await expect(ui.locator('h1')).toContainText('List of projects');
}

export async function openProjectFromList(ui: Page, mediaFileName: string): Promise<void> {
  await ui.locator('.project-card').filter({hasText: mediaFileName}).first().click();
  await waitForPlayer(ui);
}

// --- What is on screen

/** The DOM subtitle (the interactive renderer, SRT or ASS): its text and whether the overlay is currently hidden. */
export const domSubtitle = (ui: Page): Promise<{ text: string | null; hidden: boolean }> => ui.evaluate(() => {
  const container = document.querySelector('.subtitle-render-container');
  const srt = document.querySelector('.srt-container > span')?.textContent?.trim();
  const ass = [...document.querySelectorAll('.ASS-dialogue')].map(e => e.textContent?.trim()).filter(Boolean).join(' ');
  return {text: srt || ass || null, hidden: !!container?.classList.contains('subtitles-hidden')};
});

/** True when the DOM subtitle with this text is on screen and not hidden. */
export async function expectDomSubtitle(ui: Page, text: string | null, timeout = 10_000): Promise<void> {
  await expect.poll(async () => {
    const s = await domSubtitle(ui);
    return s.text !== null && !s.hidden ? s.text : null;
  }, {timeout, message: text === null ? 'no DOM subtitle should be visible' : `DOM subtitle "${text}" should be visible`}).toBe(text);
}

/** The colour at the centre of the video area. On the canvas player that is a page screenshot, on the mpv-window player a desktop capture. */
export async function probeVideoColor(app: ElectronApplication, ui: Page): Promise<Rgb | null> {
  const box = await ui.locator(VIDEO_AREA).first().boundingBox();
  if (!box) {
    return null;
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  if (await ui.locator('canvas#video-surface').count() > 0) {
    const png = await ui.screenshot();
    const viewportWidth = await ui.evaluate(() => window.innerWidth);
    return app.evaluate(({nativeImage}, {b64, x, y, vw}) => {
      const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
      const size = image.getSize();
      const scale = size.width / vw;
      const px = Math.min(size.width - 1, Math.max(0, Math.round(x * scale)));
      const py = Math.min(size.height - 1, Math.max(0, Math.round(y * scale)));
      const bgra = image.crop({x: px, y: py, width: 1, height: 1}).toBitmap();
      return {r: bgra[2], g: bgra[1], b: bgra[0]};
    }, {b64: png.toString('base64'), x: cx, y: cy, vw: viewportWidth});
  }

  const content = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().uiWindow.getContentBounds());
  return (await captureComposited(app, [{x: content.x + cx, y: content.y + cy}])).colors[0];
}

/** Which clip of the fixture the video currently shows, by colour. Null when the colour matches none of them closely. */
export async function probeVideoClip(app: ElectronApplication, ui: Page): Promise<{ index: number | null; color: Rgb | null }> {
  const color = await probeVideoColor(app, ui);
  const near = nearestClip(color);
  return {index: near && near.distance < 90 ? near.index : null, color};
}

export async function expectVideoShowsClip(app: ElectronApplication, ui: Page, index: number, timeout = 10_000): Promise<void> {
  let last: { index: number | null; color: Rgb | null } = {index: null, color: null};
  try {
    await expect.poll(async () => (last = await probeVideoClip(app, ui)).index, {timeout, message: `video should show clip ${index}`}).toBe(index);
  } catch (e) {
    throw new Error(`video should show clip ${index} (${CLIP_COLORS[index]}), last probe: ${JSON.stringify(last)}
${(e as Error).message}`);
  }
}

export const onLegacyEngine = async (ui: Page): Promise<boolean> => (await ui.locator('#mpv-placeholder').count()) > 0;

/** Lets the UI settle without a fixed sleep scattered through specs; use only to prove that something does NOT happen. */
export const quiet = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Near-white pixels in the band where the subtitle text sits (bottom of the picture of the 16:9 clips fixture), from a desktop capture,
 * so it sees whatever ends up on screen: mpv's own subtitle rendering as well as the DOM overlay. Use it for "is any text drawn".
 */
export async function whitePixelsInSubtitleBand(app: ElectronApplication, ui: Page): Promise<number> {
  const box = await ui.locator(VIDEO_AREA).first().boundingBox();
  if (!box) {
    return 0;
  }
  // The 16:9 picture, letterboxed inside the video area
  let width = box.width;
  let height = width * 9 / 16;
  if (height > box.height) {
    height = box.height;
    width = height * 16 / 9;
  }
  const left = box.x + (box.width - width) / 2;
  const top = box.y + (box.height - height) / 2;
  const content = await app.evaluate(() => (globalThis as any).__yallE2E.getWindows().uiWindow.getContentBounds());

  const probes: { x: number; y: number }[] = [];
  for (let ix = 0; ix < 60; ix++) {
    for (let iy = 0; iy < 14; iy++) {
      probes.push({
        x: content.x + left + width * (0.2 + 0.6 * ix / 59),
        y: content.y + top + height * (0.68 + 0.27 * iy / 13)
      });
    }
  }
  const {colors} = await captureComposited(app, probes);
  return colors.filter(c => c && c.r > 225 && c.g > 225 && c.b > 225).length;
}

/**
 * Samples (current clip, mpv speed) every 50 ms inside the page and keeps a count per pair, so a slow test runner cannot
 * miss a state that only lasts a few seconds. Read the result with `speedSamples`.
 */
export async function startSpeedSampler(ui: Page): Promise<void> {
  await ui.evaluate(() => {
    const w = window as any;
    w.__e2eSpeedSamples = {};
    w.__e2eSpeedTimer = setInterval(async () => {
      const clip = w.__e2ePlayback?.currentClipIndex;
      if (clip === undefined) {
        return;
      }
      const speed = Number(await w.electronAPI.mpvGetProperty('speed'));
      const bucket = (w.__e2eSpeedSamples[clip] ??= {});
      bucket[speed] = (bucket[speed] ?? 0) + 1;
    }, 50);
  });
}

export type SpeedSamples = Record<string, Record<string, number>>;

export const speedSamples = (ui: Page): Promise<SpeedSamples> => ui.evaluate(() => (window as any).__e2eSpeedSamples ?? {});

/** The speed mpv ran at for most of the samples taken while the clip was current, with how many samples that is. */
export function dominantSpeed(samples: SpeedSamples, clip: number): { speed: number; count: number } | null {
  const bucket = samples[clip];
  if (!bucket) {
    return null;
  }
  const [speed, count] = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0];
  return {speed: Number(speed), count};
}
