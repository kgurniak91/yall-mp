import {RebuildGeneration} from './rebuild-generation';

describe('RebuildGeneration', () => {
  it('keeps a lone rebuild valid', () => {
    const generation = new RebuildGeneration();
    expect(generation.begin()()).toBeTrue();
  });

  it('invalidates the read-back of an older rebuild when a newer one started (two quick resizes)', () => {
    const generation = new RebuildGeneration();
    const first = generation.begin();
    const second = generation.begin();
    expect(first()).toBeFalse();
    expect(second()).toBeTrue();
  });

  it('only the last of many overlapping rebuilds stays valid', () => {
    const generation = new RebuildGeneration();
    const tickets = Array.from({length: 10}, () => generation.begin());
    expect(tickets.map(isCurrent => isCurrent())).toEqual([...Array(9).fill(false), true]);
  });

  it('cancel invalidates everything that is running', () => {
    const generation = new RebuildGeneration();
    const ticket = generation.begin();
    generation.cancel();
    expect(ticket()).toBeFalse();
    expect(generation.begin()()).toBeTrue();
  });
});
