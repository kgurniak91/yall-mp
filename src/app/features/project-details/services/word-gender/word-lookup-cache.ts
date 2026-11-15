/**
 * The word lookups behind the colouring: one answer per word, remembered (least recently used dropped first), at most
 * a few requests to Yomitan at a time. Hover lookups share the same Yomitan window, and a request that waits more than
 * 10 s makes the main process recycle that window, so a burst of lines (jumping through subtitles) must not flood it.
 * A queued lookup that only lines no longer shown asked for is dropped before it is sent. Pure (no Angular), so the
 * Vitest suite covers it.
 */

/** Returned by an ask function for an answer that must not be remembered (an error reply, not a real "no entry"). */
export const NOT_CACHED = Symbol('not cached');

interface Entry<T> {
  promise: Promise<T | null>;
  /** The newest line that asked for this word. */
  line: number;
}

export interface WordLookupCacheOptions {
  maxInFlight: number;
  maxEntries: number;
}

export class WordLookupCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly queue: Array<() => void> = [];
  private inFlight = 0;
  private latestLine = 0;

  constructor(private readonly ask: (word: string) => Promise<T | null | typeof NOT_CACHED>,
              private readonly options: WordLookupCacheOptions = {maxInFlight: 4, maxEntries: 5000}) {
  }

  /** Starts a new line: lookups still queued for older lines are dropped unless this line asks for them too. */
  newLine(): number {
    return ++this.latestLine;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  lookup(word: string, line: number): Promise<T | null> {
    const cached = this.entries.get(word);
    if (cached) {
      cached.line = Math.max(cached.line, line);
      // Most recently used goes last, so the oldest is dropped first
      this.entries.delete(word);
      this.entries.set(word, cached);
      return cached.promise;
    }
    const entry: Entry<T> = {promise: Promise.resolve(null), line};
    entry.promise = this.schedule(word, entry);
    this.entries.set(word, entry);
    if (this.entries.size > this.options.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return entry.promise;
  }

  private forget(word: string, entry: Entry<T>): void {
    // Only this entry: a newer one for the same word (after a clear) stays
    if (this.entries.get(word) === entry) {
      this.entries.delete(word);
    }
  }

  private schedule(word: string, entry: Entry<T>): Promise<T | null> {
    return new Promise<T | null>(resolve => {
      const run = async () => {
        if (entry.line !== this.latestLine) {
          // Nobody is waiting for it any more; a later line asks again. The loop in next() goes on to the next task.
          this.forget(word, entry);
          resolve(null);
          return;
        }
        this.inFlight++;
        try {
          const answer = await this.ask(word);
          if (answer === NOT_CACHED) {
            this.forget(word, entry);
            resolve(null);
          } else {
            resolve(answer);
          }
        } catch {
          this.forget(word, entry);
          resolve(null);
        } finally {
          this.inFlight--;
          this.next();
        }
      };
      this.queue.push(() => void run());
      this.next();
    });
  }

  private next(): void {
    // A started task counts as in flight as soon as it is called (before its first await)
    while (this.inFlight < this.options.maxInFlight && this.queue.length > 0) {
      this.queue.shift()!();
    }
  }
}
