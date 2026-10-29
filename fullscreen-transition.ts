// Entering fullscreen again right after the window left it makes the OS remember bounds from the middle of the leave
// transition, so the window comes back at the wrong size. Leaving is always allowed (it restores the bounds saved
// before entering); entering is dropped until the previous leave has settled. Pure, so it can be unit tested.

/** After the leave event the window still settles for a moment. */
export const FULLSCREEN_SETTLE_MS = 150;
/** A leave request that never produces an event (the window was not in fullscreen) must not block entering forever. */
export const FULLSCREEN_SAFETY_MS = 1500;

export class FullscreenTransitionGuard {
  private enterBlockedUntil = 0;

  constructor(
    private readonly settleMs = FULLSCREEN_SETTLE_MS,
    private readonly safetyMs = FULLSCREEN_SAFETY_MS
  ) {
  }

  /** True when the request may go ahead. A request to enter is dropped while the last leave has not settled. */
  tryBegin(entering: boolean, now: number = Date.now()): boolean {
    if (entering) {
      return now >= this.enterBlockedUntil;
    }
    this.enterBlockedUntil = now + this.safetyMs;
    return true;
  }

  /** The window reported `enter-full-screen` (`entered`) or `leave-full-screen`. */
  end(entered: boolean, now: number = Date.now()): void {
    this.enterBlockedUntil = entered ? 0 : now + this.settleMs;
  }
}
