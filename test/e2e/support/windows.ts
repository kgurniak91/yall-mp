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
  display: { id: number; workArea: Rect; scaleFactor: number };
}

export interface WindowStates {
  main: WindowState | null;
  ui: WindowState | null;
  video: WindowState | null;
}

/** Snapshot of the three stacked windows, read through the main-side __yallE2E probe (only present under YALL_MP_E2E=1). */
export async function getWindowStates(app: ElectronApplication): Promise<WindowStates> {
  return app.evaluate(({screen}) => {
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
        display: {id: display.id, workArea: display.workArea, scaleFactor: display.scaleFactor}
      };
    };
    return {main: describe(wins.mainWindow), ui: describe(wins.uiWindow), video: describe(wins.videoWindow)};
  });
}

/** Runs a function against the real BrowserWindow objects in the main process. */
export async function withWindows<T>(
  app: ElectronApplication,
  fn: (wins: { mainWindow: any, uiWindow: any, videoWindow: any }) => T
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
