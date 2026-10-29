/**
 * The ASS renderer is rebuilt on every size change and reads its scale back two animation frames later. Rebuilds can
 * overlap while a window edge is dragged, and a read-back that belongs to an older rebuild would find the newer
 * renderer half set up and store a stale scale. Each rebuild asks for a ticket; only the latest ticket stays valid.
 */
export class RebuildGeneration {
  private current = 0;

  /** Starts a rebuild. The returned function tells whether it is still the latest one. */
  begin(): () => boolean {
    const mine = ++this.current;
    return () => mine === this.current;
  }

  /** The renderer was destroyed: running rebuilds must not touch anything anymore. */
  cancel(): void {
    this.current++;
  }
}
