// The app window may be larger than the display it was moved to. On Windows and macOS the page knows its display
// (screen.availWidth/availHeight follows the monitor the window is on) and asks the main process to shrink the window when it
// does not fit. On Linux the main process knows the exact window position (the app runs on X11/XWayland, a native Wayland
// client knows neither its position nor its monitor) and fits the window itself, see boundsInsideWorkArea.

/** The smallest window the layout supports (a smaller display makes the window fit it, see windowFitSize). */
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

export interface Size {
  width: number;
  height: number;
}

export interface WindowFit extends Size {
  minWidth: number;
  minHeight: number;
}

/** The size the window gets on a display with the given available area, or null when it fits already (or the report is not credible). */
export function windowFitSize(content: Size, available: Size): WindowFit | null {
  const usable = [available.width, available.height].every(value => Number.isFinite(value) && value >= 200);
  if (!usable) {
    return null;
  }
  const width = Math.min(content.width, Math.floor(available.width));
  const height = Math.min(content.height, Math.floor(available.height));
  if (width === content.width && height === content.height) {
    return null;
  }
  // The minimum must not exceed the display either, or the window could never fit
  return {width, height, minWidth: Math.min(MIN_WINDOW_WIDTH, width), minHeight: Math.min(MIN_WINDOW_HEIGHT, height)};
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * The bounds a window gets when it is larger than the work area of the display it is on: shrunk to the work area and moved
 * inside it, so nothing is cut off. A window that fits is left alone (it may stick out a little on purpose), returns null.
 * Only for platforms where the window position is exact (not a native Wayland client).
 */
export function boundsInsideWorkArea(bounds: Rect, workArea: Rect): Rect | null {
  const usable = [workArea.width, workArea.height].every(value => Number.isFinite(value) && value >= 200);
  if (!usable || (bounds.width <= workArea.width && bounds.height <= workArea.height)) {
    return null;
  }
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const clamp = (value: number, low: number, size: number, areaSize: number) =>
    Math.min(Math.max(value, low), low + areaSize - size);
  return {
    x: clamp(bounds.x, workArea.x, width, workArea.width),
    y: clamp(bounds.y, workArea.y, height, workArea.height),
    width,
    height
  };
}
