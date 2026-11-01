import {PlayerState} from '../../../model/video.types';

export interface HoverPauseActions {
  pause(): void;

  resume(): void;

  /** Asked right before resuming; false when something else (an open dialog) took over, which cancels the resume. */
  canResume?(): boolean;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether the point lies inside any of the rects, each grown by `padding` on every side. */
export function isPointNearRects(x: number, y: number, rects: readonly Rect[], padding: number): boolean {
  return rects.some(r => x >= r.left - padding && x <= r.right + padding && y >= r.top - padding && y <= r.bottom + padding);
}

/**
 * Pauses playback while the pointer is over the subtitles and resumes it when the pointer leaves, but only when the
 * pause came from the hover and nothing else happened in between. The caller does the geometry and feeds in pointer
 * movements, player state changes and interactions; the controller only decides when to pause and resume.
 */
export class HoverPauseController {
  private armed = true;
  private isInside = false;
  private pausedByHover = false;
  private awaitingOurPause = false;
  private holding = false;
  private state: PlayerState | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly actions: HoverPauseActions, private readonly resumeDelayMs = 150) {
  }

  /**
   * A pointer movement. `canPause` is true when the setting is on, the subtitles are shown and rendered by the app,
   * and nothing else (menu, dialog, selection) holds the pointer.
   */
  public pointerMoved(inside: boolean, canPause: boolean): void {
    if (inside) {
      this.cancelResume();
      if (this.isInside) {
        return;
      }
      this.isInside = true;
      const wasArmed = this.armed;
      this.armed = false;
      if (wasArmed && canPause && this.state === PlayerState.Playing) {
        this.pausedByHover = true;
        this.awaitingOurPause = true;
        this.actions.pause();
      }
      return;
    }

    if (!this.isInside) {
      return;
    }
    this.isInside = false;
    this.armed = true;
    if (this.pausedByHover) {
      this.cancelResume();
      this.resumeTimer = setTimeout(() => this.resumeIfStillOurs(), this.resumeDelayMs);
    }
  }

  /** The user did something with the subtitles or the player: a click, a lookup, a menu, a dialog, a key. */
  public interaction(): void {
    this.pausedByHover = false;
    this.awaitingOurPause = false;
    this.cancelResume();
  }

  /**
   * Something transient (the lookup popup) is open: a pending resume waits for it instead of being cancelled, and
   * happens once it is released and the pointer is outside the subtitles.
   */
  public setHolding(holding: boolean): void {
    if (this.holding === holding) {
      return;
    }
    this.holding = holding;
    if (!holding && this.pausedByHover && !this.isInside) {
      this.cancelResume();
      this.resumeTimer = setTimeout(() => this.resumeIfStillOurs(), this.resumeDelayMs);
    }
  }

  public playerStateChanged(state: PlayerState): void {
    this.state = state;
    if (!this.pausedByHover) {
      return;
    }
    if (this.awaitingOurPause) {
      if (state === PlayerState.PausedByUser) {
        this.awaitingOurPause = false;
      } else if (state !== PlayerState.Playing) {
        this.interaction();
      }
      return;
    }
    if (state !== PlayerState.PausedByUser) {
      this.interaction();
    }
  }

  /** The setting was switched off or the subtitles went away: forget everything. */
  public reset(): void {
    this.interaction();
    this.holding = false;
    this.isInside = false;
    this.armed = true;
  }

  public dispose(): void {
    this.cancelResume();
  }

  private resumeIfStillOurs(): void {
    this.resumeTimer = null;
    if (this.holding) {
      return;
    }
    if (!this.pausedByHover || this.awaitingOurPause || this.state !== PlayerState.PausedByUser) {
      return;
    }
    if (this.actions.canResume && !this.actions.canResume()) {
      this.interaction();
      return;
    }
    this.pausedByHover = false;
    this.actions.resume();
  }

  private cancelResume(): void {
    if (this.resumeTimer != null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }
}
