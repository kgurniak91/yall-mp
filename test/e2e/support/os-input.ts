import * as windows from './os-input-win';
import * as linux from './os-input-linux';

/** Real OS mouse input: Windows (mouse_event) and Linux X11 (xdotool). macOS and Wayland have none. */
export const osInputAvailable = process.platform === 'win32' || linux.xdotoolAvailable();

const impl = process.platform === 'win32' ? windows : linux;

export const dragMouse = impl.dragMouse;
export const clickMouse = impl.clickMouse;
export const doubleClickMouse = impl.doubleClickMouse;
