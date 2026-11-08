// On Linux the packaged app runs through X11 (on a Wayland desktop that is XWayland, which every mainstream distribution
// ships). A native Wayland client cannot learn where its window is or on which monitor: the window bounds, `screen` and the
// cursor position all go stale, so a window dragged to a smaller monitor cannot be fitted to it, and a fullscreen window can
// reach the screen stretched for a moment (GNOME). Under X11 the window position and the display are exact.
//
// Electron picks the platform before any of our code runs (and sets `--ozone-platform=wayland` itself on a Wayland desktop),
// so a switch added from JavaScript is too late: the packaged app starts once, sees it is a Wayland client and relaunches
// itself with `--ozone-platform=x11`. An explicit `--ozone-platform=...` on the command line wins (to test native Wayland).
// A development run (`electron .`) is not relaunched: pass the switch by hand.

export interface X11RelaunchEnv {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** An end-to-end test run: the test driver is attached to this very process, so it must not be replaced. */
  e2e: boolean;
  /** The command line (argv) names an ozone platform. */
  ozonePlatformArgument: boolean;
  /** The ozone platform this process runs on (Electron's own choice when nothing was passed). */
  currentOzonePlatform: string;
  /** `DISPLAY`: an X server (or XWayland) can be reached. */
  hasX11Display: boolean;
}

export const X11_ARGUMENT = '--ozone-platform=x11';

/**
 * How the app starts itself again. An AppImage starts through its own file: the mount of the running process goes away with it.
 * One that runs from an extraction (no FUSE on the machine, started with --appimage-extract-and-run) must start extracted again,
 * or the second start would fail the same way FUSE did.
 */
export function x11RelaunchCommand(env: { execPath: string; argv: readonly string[]; appImage?: string; appDir?: string }): { execPath: string; args: string[] } {
  const args = [...env.argv.slice(1), X11_ARGUMENT];
  if (!env.appImage) {
    return {execPath: env.execPath, args};
  }
  const mountedByFuse = (env.appDir ?? '').includes('/.mount_');
  return {execPath: env.appImage, args: mountedByFuse ? args : ['--appimage-extract-and-run', ...args]};
}

export function hasOzonePlatformArgument(argv: readonly string[]): boolean {
  return argv.some(arg => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='));
}

export function shouldRelaunchWithX11(env: X11RelaunchEnv): boolean {
  if (env.platform !== 'linux' || !env.packaged || env.e2e || env.ozonePlatformArgument) {
    return false;
  }
  // Without any X server (a Wayland-only session without XWayland) the relaunch would stop the app from starting
  return env.currentOzonePlatform !== 'x11' && env.hasX11Display;
}

/** True when the window runs as a native Wayland client (the Wayland-specific workarounds apply only then). */
export function isNativeWayland(ozonePlatform: string, env: { platform: NodeJS.Platform; sessionType?: string; hasWaylandDisplay: boolean }): boolean {
  if (env.platform !== 'linux') {
    return false;
  }
  if (ozonePlatform) {
    return ozonePlatform === 'wayland';
  }
  return env.sessionType === 'wayland' && env.hasWaylandDisplay;
}
