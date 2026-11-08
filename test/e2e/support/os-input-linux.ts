import {execFileSync} from 'child_process';

/** Real mouse input on an X11 session through xdotool. Wayland refuses synthetic input, so only X11 counts. */
export function xdotoolAvailable(): boolean {
  if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'x11') {
    return false;
  }
  try {
    execFileSync('xdotool', ['version'], {stdio: 'pipe'});
    return true;
  } catch {
    return false;
  }
}

function run(args: string[]): void {
  execFileSync('xdotool', args, {stdio: 'pipe'});
}

const round = (value: number) => String(Math.round(value));

/**
 * Real mouse drag in physical screen pixels: press, 20 moves, release. GNOME on X11 starts a window move only after
 * the pointer left the press point and does not count the first steps, so a moved window ends about 10% short of the
 * pointer distance (the specs allow for that); the pointer itself ends exactly on `to`.
 */
export function dragMouse(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const steps = 20;
  const args = ['mousemove', round(from.x), round(from.y), 'sleep', '0.15', 'mousedown', '1', 'sleep', '0.15'];
  for (let i = 1; i <= steps; i++) {
    args.push('mousemove', round(from.x + (to.x - from.x) * i / steps), round(from.y + (to.y - from.y) * i / steps), 'sleep', '0.02');
  }
  args.push('sleep', '0.2', 'mouseup', '1');
  run(args);
}

export function clickMouse(at: { x: number; y: number }): void {
  run(['mousemove', round(at.x), round(at.y), 'sleep', '0.1', 'click', '1']);
}

export function doubleClickMouse(at: { x: number; y: number }): void {
  run(['mousemove', round(at.x), round(at.y), 'sleep', '0.1', 'click', '--repeat', '2', '--delay', '60', '1']);
}
