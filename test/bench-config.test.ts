import {describe, expect, it} from 'vitest';
import {parseBenchConfig} from '../bench-config';

describe('parseBenchConfig', () => {
  it('fills in defaults', () => {
    expect(parseBenchConfig({out: 'r.json'})).toEqual({warmupSec: 10, measureSec: 60, width: 1600, height: 900, out: 'r.json'});
  });

  it('keeps valid values and rounds the size', () => {
    expect(parseBenchConfig({out: 'r.json', warmupSec: 5, measureSec: 30, width: 1280.4, height: 720})).toEqual(
      {warmupSec: 5, measureSec: 30, width: 1280, height: 720, out: 'r.json'});
  });

  it('replaces out-of-range or non-numeric values by the defaults', () => {
    const config = parseBenchConfig({out: 'r.json', warmupSec: -1, measureSec: 'x', width: 100, height: 99999});
    expect(config).toMatchObject({warmupSec: 10, measureSec: 60, width: 1600, height: 900});
  });

  it('requires an output path', () => {
    expect(() => parseBenchConfig({})).toThrow();
    expect(() => parseBenchConfig(null)).toThrow();
  });
});
