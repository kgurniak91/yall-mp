// An AppImage that nobody integrated into the desktop has no .desktop file, and on Wayland (the default Ubuntu
// session) the shell finds the icon of a window only through that file: the window icon set by the app is ignored, so
// the dock shows a generic cogwheel. When the app runs as an AppImage it therefore registers itself once in the user's
// own application folder. Pure functions over an injected file system, so they can be unit tested.

import {posix as path} from 'path';

/** The window class Electron reports for the executable `yall-mp`; the entry must name it for the shell to match. */
export const DESKTOP_ENTRY_NAME = 'yall-mp';
const MAX_ICON_SIZE = 512;
const MANAGED_MARKER = 'X-Yall-Mp-Managed=true';

export interface DesktopEntryFs {
  existsSync(file: string): boolean;
  readFileSync(file: string, encoding: 'utf8'): string;
  writeFileSync(file: string, data: string | Buffer): void;
  mkdirSync(dir: string, options: { recursive: true }): unknown;
}

export interface DesktopEntryOptions {
  /** `process.env.APPIMAGE`: the path of the AppImage file that is running, unset when not an AppImage. */
  appImagePath: string | undefined;
  /** `XDG_DATA_HOME` or `~/.local/share`. */
  dataHome: string;
  /** The app icon (PNG); the entry is skipped without one. */
  icon: Buffer | null;
  fs: DesktopEntryFs;
}

export type DesktopEntryResult = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * One Exec argument in double quotes. Two layers apply (desktop entry spec): the quoting layer puts a backslash in
 * front of a double quote, a backtick, a dollar sign and a backslash; the string layer then doubles every backslash of
 * the file value. A percent sign is a field code and is doubled.
 */
function quoteExecArgument(value: string): string {
  const quoted = value.replace(/["`$\\]/g, match => `\\${match}`).replace(/%/g, '%%');
  return `"${quoted.replace(/\\/g, '\\\\')}"`;
}

export function desktopEntryText(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    "Name=Y'ALL Media Player",
    'Comment=Yet Another Language Learning Media Player',
    `Exec=${quoteExecArgument(appImagePath)} --no-sandbox %U`,
    'Terminal=false',
    'Type=Application',
    `Icon=${DESKTOP_ENTRY_NAME}`,
    `StartupWMClass=${DESKTOP_ENTRY_NAME}`,
    'Categories=AudioVideo;Player;Video;',
    MANAGED_MARKER,
    ''
  ].join('\n');
}

/** Width of a PNG from its header (the icon folder is named after it); null when it is not a PNG. */
export function pngSize(png: Buffer): number | null {
  const signature = [0x89, 0x50, 0x4e, 0x47];
  if (png.length < 24 || signature.some((byte, index) => png[index] !== byte)) {
    return null;
  }
  return png.readUInt32BE(16);
}

/**
 * Writes `<dataHome>/applications/yall-mp.desktop` and the icon when this runs as an AppImage. An entry that the user
 * or another tool wrote (no marker of ours) is left alone; one of ours is updated when the AppImage moved or was
 * renamed (the file name carries the version).
 */
export function ensureAppImageDesktopEntry(options: DesktopEntryOptions): DesktopEntryResult {
  const {appImagePath, dataHome, icon, fs} = options;
  if (!appImagePath || !path.isAbsolute(appImagePath) || !icon) {
    return 'skipped';
  }
  const size = pngSize(icon);
  // The hicolor theme has no folder above 512 px: a larger icon would never be found.
  if (!size || size > MAX_ICON_SIZE) {
    return 'skipped';
  }

  const desktopFile = path.join(dataHome, 'applications', `${DESKTOP_ENTRY_NAME}.desktop`);
  const iconFile = path.join(dataHome, 'icons', 'hicolor', `${size}x${size}`, 'apps', `${DESKTOP_ENTRY_NAME}.png`);
  const wanted = desktopEntryText(appImagePath);

  let result: DesktopEntryResult = 'created';
  if (fs.existsSync(desktopFile)) {
    const current = fs.readFileSync(desktopFile, 'utf8');
    if (!current.includes(MANAGED_MARKER)) {
      return 'skipped';
    }
    result = current === wanted ? 'unchanged' : 'updated';
  }
  if (result !== 'unchanged') {
    fs.mkdirSync(path.dirname(desktopFile), {recursive: true});
    fs.writeFileSync(desktopFile, wanted);
  }
  if (!fs.existsSync(iconFile)) {
    fs.mkdirSync(path.dirname(iconFile), {recursive: true});
    fs.writeFileSync(iconFile, icon);
    result = result === 'unchanged' ? 'updated' : result;
  }
  return result;
}
