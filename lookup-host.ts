// The subtitles lookup panel (title bar, web view, footer) is a separate frameless BrowserWindow on Windows and macOS. A
// Wayland client cannot place a window, so there it opens in the top-left corner of the screen; on Linux the panel is
// therefore a view inside the main window, whose position is only a size computation.

import {BrowserWindow, View, WebContents, WebContentsView} from 'electron';

/** The panel covers this share of the main window, centred. */
export const LOOKUP_PANEL_RATIO = 0.8;

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the panel goes inside a parent of the given content size. */
export function lookupPanelBounds(parentWidth: number, parentHeight: number): PanelBounds {
  const width = Math.round(parentWidth * LOOKUP_PANEL_RATIO);
  const height = Math.round(parentHeight * LOOKUP_PANEL_RATIO);
  return {x: Math.round((parentWidth - width) / 2), y: Math.round((parentHeight - height) / 2), width, height};
}

/** What the lookup handler needs from the panel, whatever it is made of. */
export interface LookupHost {
  /** The page with the title bar and footer. */
  readonly webContents: WebContents;
  /** Holds the web view of the looked-up site. */
  readonly contentView: View;
  /** The window a context menu opens in. */
  readonly menuWindow: BrowserWindow;
  /** A separate window hides when the main window is focused; a view inside it must not. */
  readonly hidesWhenParentFocused: boolean;
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  hide(): void;
  /** Calls the hide listeners again (the old handler did it by hand after hide). */
  emitHide(): void;
  focus(): void;
  getSize(): [number, number];
  /** Puts the panel at the place computed from the main window (a separate window gets its bounds, a view its size). */
  place(parent: PanelBounds): void;
  /** Loads the panel page. */
  loadPage(file: string): Promise<void>;
  /** Replaces the single listener for size changes of the panel. */
  setResizeListener(listener: () => void): void;
  onHide(listener: () => void): void;
  destroy(): void;
}

/** The panel as a window of its own (Windows, macOS). */
export class WindowLookupHost implements LookupHost {
  public readonly hidesWhenParentFocused = true;
  private readonly window: BrowserWindow;

  constructor(parent: BrowserWindow, initial: PanelBounds, hostPreload: string) {
    this.window = new BrowserWindow({
      ...initial,
      parent,
      frame: false,
      show: false,
      title: 'Subtitles Lookup',
      backgroundColor: '#ffffff',
      webPreferences: {preload: hostPreload}
    });
    this.window.on('close', event => {
      event.preventDefault();
      this.window.hide();
    });
  }

  get webContents(): WebContents {
    return this.window.webContents;
  }

  get contentView(): View {
    return this.window.contentView;
  }

  get menuWindow(): BrowserWindow {
    return this.window;
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed();
  }

  isVisible(): boolean {
    return this.window.isVisible();
  }

  show(): void {
    this.window.show();
  }

  hide(): void {
    this.window.hide();
  }

  emitHide(): void {
    this.window.emit('hide');
  }

  focus(): void {
    this.window.focus();
  }

  getSize(): [number, number] {
    return this.window.getSize() as [number, number];
  }

  place(bounds: PanelBounds): void {
    this.window.setBounds(bounds);
  }

  loadPage(file: string): Promise<void> {
    return this.window.loadFile(file);
  }

  setResizeListener(listener: () => void): void {
    this.window.removeAllListeners('resize');
    this.window.on('resize', listener);
  }

  onHide(listener: () => void): void {
    this.window.on('hide', listener);
  }

  destroy(): void {
    this.window.destroy();
  }
}

/** The panel as views inside the main window (Linux). */
export class OverlayLookupHost implements LookupHost {
  public readonly hidesWhenParentFocused = false;
  private readonly container = new View();
  private readonly hostView: WebContentsView;
  private readonly hideListeners: Array<() => void> = [];
  private resizeListener: (() => void) | null = null;
  private visible = false;
  private destroyed = false;
  private readonly relayoutHandler = () => this.relayout();

  constructor(private readonly parent: BrowserWindow, hostPreload: string) {
    this.hostView = new WebContentsView({webPreferences: {preload: hostPreload}});
    this.container.addChildView(this.hostView);
    this.container.setVisible(false);
    parent.contentView.addChildView(this.container);
    for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      parent.on(event as any, this.relayoutHandler);
    }
  }

  get webContents(): WebContents {
    return this.hostView.webContents;
  }

  get contentView(): View {
    return this.container;
  }

  get menuWindow(): BrowserWindow {
    return this.parent;
  }

  isDestroyed(): boolean {
    return this.destroyed || this.parent.isDestroyed();
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.relayout();
    // Adding it again puts it above everything else in the window
    this.parent.contentView.addChildView(this.container);
    this.container.setVisible(true);
    this.visible = true;
  }

  hide(): void {
    if (!this.visible) {
      return;
    }
    this.container.setVisible(false);
    this.visible = false;
    this.emitHide();
  }

  emitHide(): void {
    for (const listener of this.hideListeners) {
      listener();
    }
  }

  focus(): void {
    this.hostView.webContents.focus();
  }

  getSize(): [number, number] {
    const bounds = this.container.getBounds();
    return [bounds.width, bounds.height];
  }

  place(): void {
    this.relayout();
  }

  loadPage(file: string): Promise<void> {
    // The query tells the page that there is no window to drag
    return this.hostView.webContents.loadFile(file, {query: {overlay: '1'}});
  }

  setResizeListener(listener: () => void): void {
    this.resizeListener = listener;
  }

  onHide(listener: () => void): void {
    this.hideListeners.push(listener);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      this.parent.removeListener(event as any, this.relayoutHandler);
    }
    if (!this.parent.isDestroyed()) {
      this.parent.contentView.removeChildView(this.container);
    }
    (this.hostView.webContents as any).destroy?.();
  }

  private relayout(): void {
    if (this.isDestroyed()) {
      return;
    }
    const [width, height] = this.parent.getContentSize();
    const bounds = lookupPanelBounds(width, height);
    this.container.setBounds(bounds);
    this.hostView.setBounds({x: 0, y: 0, width: bounds.width, height: bounds.height});
    this.resizeListener?.();
  }
}

/** The panel for this platform. */
export function createLookupHost(parent: BrowserWindow, initial: PanelBounds, hostPreload: string): LookupHost {
  return process.platform === 'linux' ? new OverlayLookupHost(parent, hostPreload) : new WindowLookupHost(parent, initial, hostPreload);
}
