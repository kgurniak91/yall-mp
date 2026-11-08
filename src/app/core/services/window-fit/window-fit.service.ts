import {Injectable, OnDestroy} from '@angular/core';

/** True when the window is larger than the display it is on (the tolerance absorbs rounding). */
export function exceedsDisplay(inner: { width: number; height: number }, available: { width: number; height: number }): boolean {
  const usable = available.width > 0 && available.height > 0;
  return usable && (inner.width > available.width + 1 || inner.height > available.height + 1);
}

/**
 * Keeps the window inside the display it is on (Windows and macOS; on Linux the main process fits the window after a move).
 * The page knows its display: `screen.availWidth/availHeight` follows the monitor the window is on. There is no event for moving to another monitor,
 * so the check runs once a second and on resize; it only costs two property reads.
 */
@Injectable({providedIn: 'root'})
export class WindowFitService implements OnDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onResize = () => this.check();

  start(): void {
    if (this.timer !== null || !window.electronAPI?.windowFitToDisplay) {
      return;
    }
    this.timer = setInterval(() => this.check(), 1000);
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    window.removeEventListener('resize', this.onResize);
  }

  private check(): void {
    const available = {width: window.screen.availWidth, height: window.screen.availHeight};
    if (exceedsDisplay({width: window.innerWidth, height: window.innerHeight}, available)) {
      window.electronAPI.windowFitToDisplay(available);
    }
  }
}
