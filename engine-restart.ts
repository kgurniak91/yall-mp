// Decides whether the playback engine may be restarted after it stopped unexpectedly. Pure, so it can be unit tested.

export const ENGINE_RESTART_WINDOW_MS = 60_000;

export class EngineRestartPolicy {
  private lastRestartAt: number | null = null;

  constructor(private readonly windowMs = ENGINE_RESTART_WINDOW_MS) {
  }

  /** True (and the attempt is recorded) when no restart happened within the window; a second failure inside it means giving up. */
  tryRestart(now: number = Date.now()): boolean {
    if (this.lastRestartAt !== null && now - this.lastRestartAt < this.windowMs) {
      return false;
    }
    this.lastRestartAt = now;
    return true;
  }

  reset(): void {
    this.lastRestartAt = null;
  }
}
