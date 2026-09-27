// Where mpv paints its video.
//
// Windows/Linux (`ChildWindowVideoSurface`): a transparent, mouse-through child
// BrowserWindow that a separate mpv process draws into via `--wid`.
//
// macOS (`NativeViewVideoSurface`): libmpv runs inside this process and paints
// into a native view placed underneath the UI window's web view (see
// native/mpv-embed/README.md). mpv has no `--wid` support on macOS, so the
// child-window design cannot work there.

import {BrowserWindow, Rectangle} from 'electron';
import {loadMpvEmbed, MpvEmbedBinding, MpvEmbedEvent, MpvEmbedStats, WindowWatchEvent} from './mpv-embed';

export type VideoSurfaceKind = 'child-window' | 'native-view';

/** What MpvManager needs from the surface. */
export interface MpvHost {
  /** Separate-process mode: native window id to pass as `--wid`. */
  getMpvWindowId(): number | null;

  /**
   * In-process mode: start libmpv inside the host with the given options
   * (applied before mpv_initialize). Present only on surfaces that embed
   * libmpv themselves.
   */
  createEmbeddedMpv?(options: [string, string][], onEvent: (event: MpvEmbedEvent) => void): EmbeddedMpvInfo;
  destroyEmbeddedMpv?(): void;
}

export interface EmbeddedMpvInfo {
  renderer: 'gl' | 'sw';
  libmpvPath: string;
  rejectedOptions: string[];
}

export interface VideoSurface extends MpvHost {
  readonly kind: VideoSurfaceKind;

  /** Video rectangle in DIPs, relative to the host window's content area. */
  setVideoBounds(rect: Rectangle): void;

  /** Host window moved or resized; child windows cover the new bounds. */
  followHost(bounds: Rectangle): void;

  show(): void;

  hide(): void;

  isVisible(): boolean;

  destroy(): void;

  isDestroyed(): boolean;
}

// ---------------------------------------------------------------------------

export class ChildWindowVideoSurface implements VideoSurface {
  public readonly kind: VideoSurfaceKind = 'child-window';
  public readonly window: BrowserWindow;

  constructor(private readonly host: BrowserWindow, onBeforeInput: (event: Electron.Event, input: Electron.Input) => void) {
    // Borderless, independent window that mpv draws into.
    this.window = new BrowserWindow({
      frame: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      resizable: false,
      focusable: false,
      parent: host,
    });

    this.window.setIgnoreMouseEvents(true);

    // Failsafe listener: even though focusable is false, if it somehow gets input, handle it.
    this.window.webContents.on('before-input-event', onBeforeInput);
  }

  getMpvWindowId(): number | null {
    // HWND on Windows and X11 window ids fit in 32 bits.
    return this.window.getNativeWindowHandle().readInt32LE(0);
  }

  setVideoBounds(rect: Rectangle): void {
    if (this.isDestroyed()) {
      return;
    }
    const [hostX, hostY] = this.host.getPosition();
    this.window.setBounds({
      x: hostX + rect.x,
      y: hostY + rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  followHost(bounds: Rectangle): void {
    if (!this.isDestroyed()) {
      this.window.setBounds(bounds);
    }
  }

  show(): void {
    if (!this.isDestroyed()) {
      this.window.setOpacity(1);
      this.window.showInactive();
    }
  }

  hide(): void {
    if (!this.isDestroyed()) {
      this.window.setOpacity(0);
      this.window.hide();
    }
  }

  isVisible(): boolean {
    return !this.isDestroyed() && this.window.isVisible();
  }

  destroy(): void {
    if (!this.isDestroyed()) {
      this.window.close();
    }
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed();
  }
}

// ---------------------------------------------------------------------------

export class NativeViewVideoSurface implements VideoSurface {
  public readonly kind: VideoSurfaceKind = 'native-view';

  private readonly embed: MpvEmbedBinding;
  private sessionId: number | null = null;
  private visible = false;
  private destroyed = false;

  constructor(private readonly host: BrowserWindow) {
    const embed = loadMpvEmbed();
    if (!embed) {
      throw new Error('Native video add-on is unavailable.');
    }
    this.embed = embed;
  }

  /** Adds the black backdrop to a window before any video exists. */
  static attachBackdrop(window: BrowserWindow): boolean {
    const embed = loadMpvEmbed();
    if (!embed) {
      return false;
    }
    try {
      embed.attach(window.getNativeWindowHandle(), 'below');
      return true;
    } catch (error) {
      console.error('[NativeViewVideoSurface] Could not attach the backdrop view:', error);
      return false;
    }
  }

  /**
   * Reports the window's full-screen transitions as they start (synchronously, before
   * AppKit resizes the window). Returns false when the add-on in use predates this.
   */
  static watchWindow(window: BrowserWindow, onEvent: (event: WindowWatchEvent) => void): boolean {
    const embed = loadMpvEmbed();
    if (!embed || typeof embed.watchWindow !== 'function') {
      return false;
    }
    try {
      embed.watchWindow(window.getNativeWindowHandle(), onEvent);
      return true;
    } catch (error) {
      console.error('[NativeViewVideoSurface] Could not watch the window:', error);
      return false;
    }
  }

  /**
   * Locks the window to the video's shape for user resizes (see setWindowAspectLock in the
   * add-on); `aspect` 0 unlocks. Returns false when the add-on in use predates this.
   */
  static setAspectLock(window: BrowserWindow, aspect: number, extra: {width: number; height: number}, minVideoWidth: number): boolean {
    const embed = loadMpvEmbed();
    if (!embed || typeof embed.setWindowAspectLock !== 'function') {
      return false;
    }
    try {
      embed.setWindowAspectLock(window.getNativeWindowHandle(), aspect, extra.width, extra.height, minVideoWidth);
      return true;
    } catch (error) {
      console.error('[NativeViewVideoSurface] Could not set the window aspect lock:', error);
      return false;
    }
  }

  getMpvWindowId(): number | null {
    return null;
  }

  createEmbeddedMpv(options: [string, string][], onEvent: (event: MpvEmbedEvent) => void): EmbeddedMpvInfo {
    if (this.destroyed) {
      throw new Error('Video surface already destroyed.');
    }
    if (this.sessionId !== null) {
      throw new Error('Embedded mpv already created for this surface.');
    }
    const result = this.embed.create(this.host.getNativeWindowHandle(), {
      options,
      position: 'below',
      logLevel: process.env['YALL_MPV_LOG_LEVEL'] || 'warn',
      onEvent,
    });
    this.sessionId = result.id;
    this.embed.setVisible(result.id, this.visible);
    return {
      renderer: result.renderer,
      libmpvPath: result.libmpvPath,
      rejectedOptions: result.rejectedOptions,
    };
  }

  destroyEmbeddedMpv(): void {
    if (this.sessionId !== null) {
      const id = this.sessionId;
      this.sessionId = null;
      try {
        this.embed.destroy(id);
      } catch (error) {
        console.error('[NativeViewVideoSurface] destroy failed:', error);
      }
    }
  }

  setVideoBounds(rect: Rectangle): void {
    if (this.sessionId !== null) {
      this.embed.setFrame(this.sessionId, rect.x, rect.y, rect.width, rect.height);
    }
  }

  followHost(_bounds: Rectangle): void {
    // The view lives inside the host window and moves with it.
  }

  show(): void {
    this.visible = true;
    if (this.sessionId !== null) {
      this.embed.setVisible(this.sessionId, true);
    }
  }

  hide(): void {
    this.visible = false;
    if (this.sessionId !== null) {
      this.embed.setVisible(this.sessionId, false);
    }
  }

  isVisible(): boolean {
    return this.visible && this.sessionId !== null;
  }

  stats(): MpvEmbedStats | null {
    return this.sessionId !== null ? this.embed.stats(this.sessionId) : null;
  }

  destroy(): void {
    this.destroyed = true;
    this.destroyEmbeddedMpv();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}
