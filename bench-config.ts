// Settings of the built-in benchmark run (`YALL_MP_BENCH=<path to a json file>`). Pure, so it can be unit tested.
import {readFileSync} from 'fs';

export interface BenchConfig {
  warmupSec: number;
  measureSec: number;
  width: number;
  height: number;
  /** Where the result json is written. */
  out: string;
}

const number = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

/** Applies defaults to, and range-checks, the parsed json. Throws when `out` is missing. */
export function parseBenchConfig(raw: unknown): BenchConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof source.out !== 'string' || !source.out) {
    throw new Error('The bench config needs an "out" path for the result json.');
  }
  return {
    warmupSec: number(source.warmupSec, 10, 0, 600),
    measureSec: number(source.measureSec, 60, 1, 3600),
    width: Math.round(number(source.width, 1600, 800, 7680)),
    height: Math.round(number(source.height, 900, 600, 4320)),
    out: source.out
  };
}

export function loadBenchConfig(filePath: string): BenchConfig {
  return parseBenchConfig(JSON.parse(readFileSync(filePath, 'utf8').replace(/^﻿/, '')));
}
