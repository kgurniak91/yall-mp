import {describe, expect, it} from 'vitest';
import {hasOzonePlatformArgument, isNativeWayland, shouldRelaunchWithX11, X11RelaunchEnv, x11RelaunchCommand} from '../linux-display-server';

const wayland: X11RelaunchEnv = {
  platform: 'linux', packaged: true, e2e: false, ozonePlatformArgument: false, currentOzonePlatform: 'wayland', hasX11Display: true
};

describe('shouldRelaunchWithX11', () => {
  it('relaunches a packaged Linux app that came up as a Wayland client', () => {
    expect(shouldRelaunchWithX11(wayland)).toBe(true);
  });

  it('does not relaunch twice: the relaunched process runs on x11 and carries the argument', () => {
    expect(shouldRelaunchWithX11({...wayland, currentOzonePlatform: 'x11', ozonePlatformArgument: true})).toBe(false);
  });

  it('leaves Windows, macOS, development runs and test runs alone', () => {
    expect(shouldRelaunchWithX11({...wayland, platform: 'win32'})).toBe(false);
    expect(shouldRelaunchWithX11({...wayland, platform: 'darwin'})).toBe(false);
    expect(shouldRelaunchWithX11({...wayland, packaged: false})).toBe(false);
    expect(shouldRelaunchWithX11({...wayland, e2e: true})).toBe(false);
  });

  it('respects an explicit ozone platform, also native Wayland', () => {
    expect(shouldRelaunchWithX11({...wayland, ozonePlatformArgument: true})).toBe(false);
  });

  it('does not relaunch without an X server, or the app could not start', () => {
    expect(shouldRelaunchWithX11({...wayland, hasX11Display: false})).toBe(false);
  });
});

describe('hasOzonePlatformArgument', () => {
  it('finds both spellings and ignores other switches', () => {
    expect(hasOzonePlatformArgument(['.', '--ozone-platform=wayland'])).toBe(true);
    expect(hasOzonePlatformArgument(['.', '--ozone-platform', 'x11'])).toBe(true);
    expect(hasOzonePlatformArgument(['.', '--ozone-platform-hint=auto', '--no-sandbox'])).toBe(false);
  });
});

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

describe('x11RelaunchCommand', () => {
  const argv = ['/opt/yall/yall-mp', '--no-sandbox', '/home/me/movie.mkv'];

  it('starts the same executable again with the X11 switch and the original arguments', () => {
    expect(x11RelaunchCommand({execPath: '/opt/yall/yall-mp', argv})).toEqual({
      execPath: '/opt/yall/yall-mp', args: ['--no-sandbox', '/home/me/movie.mkv', '--ozone-platform=x11']
    });
  });

  it('starts an AppImage through its own file', () => {
    expect(x11RelaunchCommand({execPath: '/tmp/.mount_yallXYZ/yall-mp', argv, appImage: '/home/me/Yall.AppImage', appDir: '/tmp/.mount_yallXYZ'})).toEqual({
      execPath: '/home/me/Yall.AppImage', args: ['--no-sandbox', '/home/me/movie.mkv', '--ozone-platform=x11']
    });
  });

  it('keeps an extracted AppImage (no FUSE) extracted', () => {
    expect(x11RelaunchCommand({execPath: '/tmp/appimage_extracted_ab12/yall-mp', argv, appImage: '/home/me/Yall.AppImage', appDir: '/tmp/appimage_extracted_ab12'})).toEqual({
      execPath: '/home/me/Yall.AppImage', args: ['--appimage-extract-and-run', '--no-sandbox', '/home/me/movie.mkv', '--ozone-platform=x11']
    });
  });
});
