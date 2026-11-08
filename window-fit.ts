// The app window may be larger than the display it was moved to (GNOME lets a window stick out). The page knows its display (screen.availWidth/availHeight follows
// the monitor the window is on, also on Wayland, where the main process gets no usable window position) and asks the main
// process to shrink the window when it does not fit.

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
