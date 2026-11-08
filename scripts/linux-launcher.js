// The packaged Linux app runs through X11 (XWayland on a Wayland desktop): a native Wayland client cannot learn where its
// window is or on which monitor (see linux-display-server.ts). Electron picks the platform before any of its own JavaScript
// runs, so the switch has to be on the command line of the real binary: the packaged `yall-mp` is a tiny launcher script
// that starts `yall-mp.bin` with `--ozone-platform=x11`. This works the same for an AppImage, a .deb and a tarball, without
// starting the app twice. An explicit `--ozone-platform=...` of the user wins (for testing native Wayland), and a system
// without any X server (a Wayland-only session without XWayland) keeps Electron's own choice, or the app would not start.
const fs = require('fs');
const path = require('path');

const REAL_BINARY_SUFFIX = '.bin';

function launcherScript(realBinaryName) {
  return `#!/bin/sh
# Starts Y'ALL Media Player through X11 (XWayland on a Wayland desktop), see scripts/linux-launcher.js
here="$(dirname "$(readlink -f "$0")")"
real="$here/${realBinaryName}"
for arg in "$@"; do
  case "$arg" in
    --ozone-platform|--ozone-platform=*) exec "$real" "$@" ;;
  esac
done
if [ -n "$DISPLAY" ]; then
  exec "$real" --ozone-platform=x11 "$@"
fi
exec "$real" "$@"
`;
}

/** Moves the Electron binary next to a launcher script of the same name. */
function installLauncher(appOutDir, executableName) {
  const launcher = path.join(appOutDir, executableName);
  const realName = executableName + REAL_BINARY_SUFFIX;
  if (!fs.existsSync(launcher) || fs.existsSync(path.join(appOutDir, realName))) {
    return false;
  }
  fs.renameSync(launcher, path.join(appOutDir, realName));
  fs.writeFileSync(launcher, launcherScript(realName), {mode: 0o755});
  fs.chmodSync(launcher, 0o755);
  return true;
}

module.exports = {launcherScript, installLauncher, REAL_BINARY_SUFFIX};
