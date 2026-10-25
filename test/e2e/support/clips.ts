import * as fs from 'fs';
import {fixture, type SeedOptions} from './seed';
import type {Rgb} from './capture';

/** One clip of the clips.mp4 fixture, as the app's clip generator cuts it (see fixtures/README.md). */
export interface ClipSpec {
  index: number;
  start: number;
  end: number;
  hasSubtitle: boolean;
  text: string | null;
  /** The solid colour the video shows during this clip, e.g. "#ff0000" */
  color: string;
}

const raw = JSON.parse(fs.readFileSync(fixture('clips.json'), 'utf8')) as { duration: number; clips: ClipSpec[] };

export const CLIPS: ClipSpec[] = raw.clips;
export const CLIPS_DURATION: number = raw.duration;
export const CLIPS_MEDIA = fixture('clips.mp4');
export const CLIPS_SRT = fixture('clips.srt');
export const CLIPS_ASS = fixture('clips.ass');

/** The subtitled clips (S1..S5 in the fixture README) in order: SUBTITLED[0] is the first one. */
export const SUBTITLED: ClipSpec[] = CLIPS.filter(c => c.hasSubtitle);

/** Index of the clip the given media time falls into (end exclusive). */
export const clipIndexAt = (time: number): number => CLIPS.findIndex(c => time >= c.start && time < c.end);

/** How far into a clip the "almost at its end" scenarios start; a slow VM needs more of the clip left than a desktop to see the playing state before the end */
export const NEAR_END = process.platform === 'linux' ? 0.4 : 0.7;

/** A time safely inside the clip, `fraction` of the way through it. */
export const inClip = (index: number, fraction = 0.5): number => {
  const c = CLIPS[index];
  return c.start + (c.end - c.start) * fraction;
};

const toRgb = (hex: string): Rgb => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/** Which clip's colour a probed pixel is closest to. The distance says how sure that is (lossy video shifts colours a little). */
export function nearestClip(color: Rgb | null): { index: number; distance: number } | null {
  if (!color) {
    return null;
  }
  let best = {index: -1, distance: Infinity};
  for (const clip of CLIPS) {
    const c = toRgb(clip.color);
    const distance = Math.hypot(color.r - c.r, color.g - c.g, color.b - c.b);
    if (distance < best.distance) {
      best = {index: clip.index, distance};
    }
  }
  return best;
}

/** Seed defaults that point a project at the clips fixture. */
export const clipsSeed = (opts: SeedOptions = {}): SeedOptions => ({
  media: CLIPS_MEDIA,
  subtitle: CLIPS_SRT,
  duration: CLIPS_DURATION,
  subtitleCount: SUBTITLED.length,
  lastSubtitleEndTime: SUBTITLED[SUBTITLED.length - 1].end,
  ...opts,
});
