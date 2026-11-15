import {describe, expect, it} from 'vitest';
import {NOT_CACHED, WordLookupCache} from '../src/app/features/project-details/services/word-gender/word-lookup-cache';

/**
 * An ask function whose answers are released by hand (oldest pending request of a word first), recording what was
 * asked and how many ran at once.
 */
function controlledAsk() {
  const asked: string[] = [];
  const pending = new Map<string, Array<{ resolve: (answer: any) => void; reject: (error: unknown) => void }>>();
  let inFlight = 0;
  let maxInFlight = 0;
  const ask = (word: string) => {
    asked.push(word);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<any>((resolve, reject) => {
      pending.set(word, [...(pending.get(word) ?? []), {resolve, reject}]);
    });
  };
  const settle = (word: string) => {
    const request = pending.get(word)?.shift();
    if (!request) {
      throw new Error(`nothing asked for ${word}`);
    }
    inFlight--;
    return request;
  };
  return {
    ask,
    asked,
    answer: (word: string, value: any = {word}) => settle(word).resolve(value),
    fail: (word: string) => settle(word).reject(new Error('not ready')),
    maxInFlight: () => maxInFlight
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('WordLookupCache', () => {
  it('asks once per word and remembers the answer', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask);
    const line = cache.newLine();
    const a = cache.lookup('Haus', line);
    const b = cache.lookup('Haus', line);
    yomitan.answer('Haus');
    expect(await a).toEqual({word: 'Haus'});
    expect(await b).toEqual({word: 'Haus'});
    expect(await cache.lookup('Haus', cache.newLine())).toEqual({word: 'Haus'});
    expect(yomitan.asked).toEqual(['Haus']);
  });

  it('sends at most maxInFlight requests at a time', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask, {maxInFlight: 2, maxEntries: 100});
    const line = cache.newLine();
    const words = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const results = words.map(w => cache.lookup(w, line));
    await flush();
    expect(yomitan.asked).toEqual(['a1', 'a2']);
    for (const word of words) {
      await flush();
      yomitan.answer(word);
    }
    expect(await Promise.all(results)).toEqual(words.map(word => ({word})));
    expect(yomitan.maxInFlight()).toBe(2);
  });

  it('drops queued lookups of a line that is no longer shown, but not the words the new line wants too', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask, {maxInFlight: 1, maxEntries: 100});
    const first = cache.newLine();
    const busy = cache.lookup('busy', first);
    const dropped = cache.lookup('dropped', first);
    const shared = cache.lookup('shared', first);

    const second = cache.newLine();
    const sharedAgain = cache.lookup('shared', second);
    yomitan.answer('busy');
    await busy;
    expect(await dropped).toBeNull();
    await flush();
    yomitan.answer('shared');
    expect(await sharedAgain).toEqual({word: 'shared'});
    expect(await shared).toEqual({word: 'shared'});
    expect(yomitan.asked).toEqual(['busy', 'shared']);

    // The dropped word is asked again when a line needs it
    const again = cache.lookup('dropped', cache.newLine());
    await flush();
    yomitan.answer('dropped');
    expect(await again).toEqual({word: 'dropped'});
  });

  it('does not remember failures or error replies', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask);
    const line = cache.newLine();
    const failed = cache.lookup('fails', line);
    const errored = cache.lookup('errors', line);
    await flush();
    yomitan.fail('fails');
    yomitan.answer('errors', NOT_CACHED);
    expect(await failed).toBeNull();
    expect(await errored).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('remembers a real "no entry" answer', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask);
    const missing = cache.lookup('xyz', cache.newLine());
    await flush();
    yomitan.answer('xyz', null);
    expect(await missing).toBeNull();
    expect(cache.size).toBe(1);
  });

  it('a failure from before a clear does not remove the newer answer', async () => {
    const yomitan = controlledAsk();
    const cache = new WordLookupCache(yomitan.ask, {maxInFlight: 4, maxEntries: 100});
    const old = cache.lookup('Haus', cache.newLine());
    await flush();
    cache.clear();
    const fresh = cache.lookup('Haus', cache.newLine());
    await flush();
    yomitan.fail('Haus');
    expect(await old).toBeNull();
    yomitan.answer('Haus');
    expect(await fresh).toEqual({word: 'Haus'});
    expect(cache.size).toBe(1);
  });

  it('drops the least recently used word over the limit', async () => {
    let asked = 0;
    const counting = new WordLookupCache(async (word: string) => {
      asked++;
      return {word};
    }, {maxInFlight: 4, maxEntries: 2});
    const l = counting.newLine();
    await counting.lookup('a', l);
    await counting.lookup('b', l);
    await counting.lookup('a', l);
    await counting.lookup('c', l);
    expect(counting.size).toBe(2);
    // "a" was used after "b", so "b" went
    await counting.lookup('a', l);
    expect(asked).toBe(3);
    await counting.lookup('b', l);
    expect(asked).toBe(4);
  });
});
