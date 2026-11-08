// On Linux the packaged app runs through X11 (on a Wayland desktop that is XWayland, which every mainstream distribution
// ships). A native Wayland client cannot learn where its window is or on which monitor: the window bounds, `screen` and the
// cursor position all go stale, so a window dragged to a smaller monitor cannot be fitted to it, and a fullscreen window can
// reach the screen stretched for a moment (GNOME). Under X11 the window position and the display are exact.
//
// Electron picks the platform before any of our JavaScript runs, so the switch is added by the launcher script that the
// packaging step puts in front of the binary (scripts/linux-launcher.js). A development run (`electron .`) needs
// `--ozone-platform=x11` by hand; an explicit `--ozone-platform=wayland` still gives native Wayland, for testing.

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
