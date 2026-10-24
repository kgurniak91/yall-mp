import type {ElectronApplication} from '@playwright/test';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  contentBounds: Rect;
  isVisible: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
  opacity: number;
  display: { id: number; bounds: Rect; workArea: Rect; scaleFactor: number };
}

export interface WindowStates {
  main: WindowState | null;
  /** Windows that are shown right now; the hidden Yomitan proxy and the lookup window do not count */
  visibleWindows: number;
}

/** Snapshot of the app window, read through the main-side __yallE2E probe (only present under YALL_MP_E2E=1). */
export async function getWindowStates(app: ElectronApplication): Promise<WindowStates> {
  return app.evaluate(({screen, BrowserWindow}) => {
    const wins = (globalThis as any).__yallE2E.getWindows();
    const describe = (win: any) => {
      if (!win || win.isDestroyed()) {
        return null;
      }
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return {
        bounds,
        contentBounds: win.getContentBounds(),
        isVisible: win.isVisible(),
        isMinimized: win.isMinimized(),
        isMaximized: win.isMaximized(),
        isFullScreen: win.isFullScreen(),
        opacity: win.getOpacity(),
        display: {id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor}
      };
    };
    return {
      main: describe(wins.mainWindow),
      visibleWindows: BrowserWindow.getAllWindows().filter(w => w.isVisible()).length
    };
  });
}

/** Runs a function against the real BrowserWindow objects in the main process. */
export async function withWindows<T>(
  app: ElectronApplication,
  fn: (wins: { mainWindow: any }) => T
): Promise<T> {
  return app.evaluate((_electron, {src}) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('wins', `return (${src})(wins)`);
    return f((globalThis as any).__yallE2E.getWindows());
  }, {src: fn.toString()});
}

export const rectsClose = (a: Rect, b: Rect, tolerance = 2): boolean =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
  Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;

export const rectContains = (outer: Rect, inner: Rect, tolerance = 2): boolean =>
  inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
  inner.x + inner.width <= outer.x + outer.width + tolerance &&
  inner.y + inner.height <= outer.y + outer.height + tolerance;
