import {describe, expect, it} from 'vitest';
import {execFileSync} from 'child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {isNativeWayland} from '../linux-display-server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {installLauncher, REAL_BINARY_SUFFIX} = require('../scripts/linux-launcher.js') as {
  installLauncher: (appOutDir: string, executableName: string) => boolean;
  REAL_BINARY_SUFFIX: string;
};

describe('isNativeWayland', () => {
  it('follows the ozone platform when one is set', () => {
    expect(isNativeWayland('x11', {platform: 'linux', sessionType: 'wayland', hasWaylandDisplay: true})).toBe(false);
    expect(isNativeWayland('wayland', {platform: 'linux', sessionType: 'x11', hasWaylandDisplay: false})).toBe(true);
  });

  it('falls back to the session when none is set', () => {
    expect(isNativeWayland('', {platform: 'linux', sessionType: 'wayland', hasWaylandDisplay: true})).toBe(true);
    expect(isNativeWayland('', {platform: 'linux', sessionType: 'x11', hasWaylandDisplay: false})).toBe(false);
  });

  it('is never true outside Linux', () => {
    expect(isNativeWayland('wayland', {platform: 'win32', sessionType: 'wayland', hasWaylandDisplay: true})).toBe(false);
  });
});

// The launcher is a /bin/sh script: run it for real on Linux and macOS
describe.skipIf(process.platform === 'win32')('Linux launcher script', () => {
  const run = (env: Record<string, string>, args: string[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'yall-launcher-'));
    try {
      // The "real binary" prints what it was started with
      writeFileSync(path.join(dir, 'yall-mp'), '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n');
      chmodSync(path.join(dir, 'yall-mp'), 0o755);
      expect(installLauncher(dir, 'yall-mp')).toBe(true);
      expect(existsSync(path.join(dir, 'yall-mp' + REAL_BINARY_SUFFIX))).toBe(true);
      expect(readFileSync(path.join(dir, 'yall-mp'), 'utf8')).toContain('exec "$real"');
      const out = execFileSync(path.join(dir, 'yall-mp'), args, {env: {PATH: process.env.PATH ?? '/usr/bin:/bin', ...env}, encoding: 'utf8'});
      // Installing twice must not wrap the launcher again
      expect(installLauncher(dir, 'yall-mp')).toBe(false);
      return out.split('\n').filter(Boolean);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };

  it('adds the X11 switch before the user arguments when an X server can be reached', () => {
    expect(run({DISPLAY: ':0'}, ['--no-sandbox', '/home/me/a movie.mkv'])).toEqual(['--ozone-platform=x11', '--no-sandbox', '/home/me/a movie.mkv']);
  });

  it('leaves the platform to Electron without an X server', () => {
    expect(run({WAYLAND_DISPLAY: 'wayland-0'}, ['--no-sandbox'])).toEqual(['--no-sandbox']);
  });

  it('respects an explicit ozone platform, both spellings', () => {
    expect(run({DISPLAY: ':0'}, ['--ozone-platform=wayland', 'x'])).toEqual(['--ozone-platform=wayland', 'x']);
    expect(run({DISPLAY: ':0'}, ['--ozone-platform', 'wayland'])).toEqual(['--ozone-platform', 'wayland']);
  });
});
