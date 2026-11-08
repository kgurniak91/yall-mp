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

// Linux/Wayland (GNOME): the first frames of a fullscreen window can reach the screen stretched to a larger size (the compositor
// shows the window's 2560x1440 picture on a 2816x1792 area, so the header icons, toolbar and timeline fall off the screen).
// It stays like that until the window state changes again. A short, invisible dip of the window opacity about a second after
// entering makes the compositor take the window state again, and the picture snaps to the right size. Measured on the display
// hardware: every wrong state was repaired this way, while a dip earlier than about 900 ms was ignored.
/** Dips after entering fullscreen; the second one covers a bad state that shows up late. */
export const FULLSCREEN_REPAIR_DELAYS_MS: readonly number[] = [1000, 1800];
/** How long the window stays at the dimmed opacity (shorter dips were not reliable). */
export const FULLSCREEN_REPAIR_HOLD_MS = 150;
/** One percent less opaque, invisible but enough for the compositor to treat it as a state change. */
export const FULLSCREEN_REPAIR_DIMMED_OPACITY = 0.99;

type TimerHandle = ReturnType<typeof setTimeout>;

export class FullscreenRepairPulse {
  private timers: TimerHandle[] = [];
  private dimmed = false;

  constructor(
    private readonly setOpacity: (opacity: number) => void,
    private readonly schedule: (callback: () => void, ms: number) => TimerHandle = setTimeout,
    private readonly cancel: (handle: TimerHandle) => void = clearTimeout,
    private readonly delaysMs: readonly number[] = FULLSCREEN_REPAIR_DELAYS_MS,
    private readonly holdMs = FULLSCREEN_REPAIR_HOLD_MS,
    private readonly dimmedOpacity = FULLSCREEN_REPAIR_DIMMED_OPACITY
  ) {
  }

  /** The window entered fullscreen. */
  start(): void {
    this.stop();
    for (const delay of this.delaysMs) {
      this.timers.push(this.schedule(() => this.pulse(), delay));
    }
  }

  /** The window left fullscreen (or closes): drop the pending dips and never leave the window dimmed. */
  stop(): void {
    for (const timer of this.timers) {
      this.cancel(timer);
    }
    this.timers = [];
    if (this.dimmed) {
      this.dimmed = false;
      this.setOpacity(1);
    }
  }

  private pulse(): void {
    if (this.dimmed) {
      return;
    }
    this.dimmed = true;
    this.setOpacity(this.dimmedOpacity);
    this.timers.push(this.schedule(() => {
      this.dimmed = false;
      this.setOpacity(1);
    }, this.holdMs));
  }
}
