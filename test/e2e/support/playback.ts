import {expect, test, type Page} from '@playwright/test';

export interface PlaybackSnapshot {
  playerState: string;
  currentClipIndex: number;
  currentTime: number;
  isPaused: boolean;
  subtitlesVisible: boolean;
  volume: number;
  isMuted: boolean;
}

/** Subscribes from the page to playback:state-update (no app code change needed) and keeps the latest value plus history. */
export async function recordPlayback(ui: Page): Promise<void> {
  await ui.evaluate(() => {
    const w = window as any;
    w.__e2eHistory = [];
    w.electronAPI.onPlaybackStateUpdate((s: PlaybackSnapshot) => {
      w.__e2ePlayback = s;
      w.__e2eHistory.push(s);
    });
  });
}

export const latestPlayback = (ui: Page): Promise<PlaybackSnapshot | undefined> =>
  ui.evaluate(() => (window as any).__e2ePlayback);

export const playbackHistory = (ui: Page): Promise<PlaybackSnapshot[]> =>
  ui.evaluate(() => (window as any).__e2eHistory ?? []);

/** Waits until the loading spinner is gone, i.e. libmpv reached the resume position (mpv:initial-seek-complete). */
export async function waitForPlayer(ui: Page): Promise<void> {
  await expect(ui.locator('#video-container')).toBeAttached({timeout: 30_000});
  await expect(ui.locator('#video-container .resizing-overlay')).toHaveCount(0, {timeout: 30_000});
  await expect(ui.locator('.interaction-blocker')).toHaveCount(0, {timeout: 30_000});
}
