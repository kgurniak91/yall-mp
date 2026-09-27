// Typed loader for the macOS native add-on in native/mpv-embed.
// See native/mpv-embed/README.md for what it does and why it exists.

import {app} from 'electron';
import * as fs from 'fs';
import path from 'path';

export interface MpvEmbedEvent {
  type: 'shutdown' | 'log' | 'render-error' | 'client-message';
  level?: string;
  prefix?: string;
  /** For 'client-message': the script-message arguments joined by newlines. */
  text: string;
}

export interface MpvEmbedProbeResult {
  ok: boolean;
  path?: string;
  apiVersion?: string;
  error?: string;
}

export interface MpvEmbedCreateOptions {
  libmpvPath?: string;
  /** Applied with mpv_set_option_string before mpv_initialize, in order. */
  options?: [string, string][];
  /** Where the video view sits relative to Chromium's web view. Default: 'below'. */
  position?: 'below' | 'above';
  /** Default 'gl' (OpenGL) with automatic fallback to 'sw'. */
  renderer?: 'gl' | 'sw';
  /** mpv log level forwarded through onEvent ('warn' by default). */
  logLevel?: string;
  onEvent?: (event: MpvEmbedEvent) => void;
}

export interface MpvEmbedCreateResult {
  id: number;
  renderer: 'gl' | 'sw';
  libmpvPath: string;
  rejectedOptions: string[];
}

export interface MpvEmbedStats {
  renderer: 'gl' | 'sw';
  renderedFrames: number;
  renderErrors: number;
  widthPixels: number;
  heightPixels: number;
  contentsScale: number;
}

export type WindowWatchEvent = 'will-enter-full-screen' | 'did-exit-full-screen';

export interface MpvEmbedBinding {
  probe(libmpvPath?: string): MpvEmbedProbeResult;
  /** Adds the opaque black backdrop view to the window (idempotent). */
  attach(windowHandle: Buffer, position?: 'below' | 'above'): void;
  /** Removes the backdrop view; destroy all sessions of that window first. */
  detach(windowHandle: Buffer): void;
  /**
   * Calls back, synchronously on the main thread, when the window starts entering or
   * has left full screen. One watcher per window; missing in add-ons built before it.
   */
  watchWindow?(windowHandle: Buffer, onEvent: (event: WindowWatchEvent) => void): void;
  unwatchWindow?(windowHandle: Buffer): void;
  /**
   * Keeps the window in the video's shape while the user resizes it: the content area is
   * `extraWidth + video width` by `extraHeight + video height` with the video at `aspect`,
   * following the edge being dragged. `aspect` 0 removes the lock. Missing in older add-ons.
   */
  setWindowAspectLock?(windowHandle: Buffer, aspect: number, extraWidth: number, extraHeight: number, minVideoWidth: number): void;
  create(windowHandle: Buffer, options?: MpvEmbedCreateOptions): MpvEmbedCreateResult;
  setFrame(id: number, x: number, y: number, width: number, height: number): void;
  setVisible(id: number, visible: boolean): void;
  destroy(id: number): void;
  stats(id: number): MpvEmbedStats | null;
}

let binding: MpvEmbedBinding | null = null;
let loadError: Error | null = null;

export function isMpvEmbedPlatform(): boolean {
  return process.platform === 'darwin';
}

export function getMpvEmbedBinaryPath(): string {
  return path.join(app.getAppPath(), 'native', 'mpv-embed', 'build', 'Release', 'yall_mpv_embed.node');
}

/**
 * Loads the add-on once. Returns null (and remembers the error) when the
 * binary is missing or cannot be loaded; see getMpvEmbedLoadError().
 */
export function loadMpvEmbed(): MpvEmbedBinding | null {
  if (binding || loadError) {
    return binding;
  }
  if (!isMpvEmbedPlatform()) {
    loadError = new Error('The embedded video surface is only available on macOS.');
    return null;
  }

  const binaryPath = getMpvEmbedBinaryPath();
  if (!fs.existsSync(binaryPath)) {
    loadError = new Error(
      `Native video add-on not found at ${binaryPath}. Run "npm run build:native" (requires Xcode Command Line Tools).`
    );
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    binding = require(binaryPath) as MpvEmbedBinding;
  } catch (error: any) {
    loadError = new Error(`Native video add-on could not be loaded: ${error?.message ?? error}`);
    return null;
  }
  return binding;
}

export function getMpvEmbedLoadError(): Error | null {
  return loadError;
}

/** True when the add-on loads and libmpv can be found. */
export function probeMpvEmbed(libmpvPath?: string): MpvEmbedProbeResult {
  const lib = loadMpvEmbed();
  if (!lib) {
    return {ok: false, error: getMpvEmbedLoadError()?.message ?? 'add-on unavailable'};
  }
  try {
    return lib.probe(libmpvPath);
  } catch (error: any) {
    return {ok: false, error: error?.message ?? String(error)};
  }
}
