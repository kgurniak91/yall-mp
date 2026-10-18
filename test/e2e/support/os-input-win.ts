import {execFileSync} from 'child_process';

const CSHARP = `
using System;
using System.Runtime.InteropServices;
public static class YallInput {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v);
  const uint DOWN = 0x0002, UP = 0x0004;
  public static void Drag(int x1, int y1, int x2, int y2, int steps, int delayMs) {
    SetProcessDpiAwareness(2);
    SetCursorPos(x1, y1); System.Threading.Thread.Sleep(100);
    mouse_event(DOWN, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(100);
    for (int i = 1; i <= steps; i++) {
      SetCursorPos(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      System.Threading.Thread.Sleep(delayMs);
    }
    System.Threading.Thread.Sleep(150);
    mouse_event(UP, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Click(int x, int y) {
    SetProcessDpiAwareness(2);
    SetCursorPos(x, y); System.Threading.Thread.Sleep(80);
    mouse_event(DOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(UP, 0, 0, 0, UIntPtr.Zero);
  }
}`;

function run(call: string): void {
  const script = `Add-Type -TypeDefinition @'\n${CSHARP}\n'@\n${call}`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {stdio: 'pipe'});
}

/** Real mouse drag in PHYSICAL screen pixels (SendInput-style, via mouse_event). */
export function dragMouse(from: { x: number; y: number }, to: { x: number; y: number }): void {
  run(`[YallInput]::Drag(${Math.round(from.x)}, ${Math.round(from.y)}, ${Math.round(to.x)}, ${Math.round(to.y)}, 20, 10)`);
}

export function clickMouse(at: { x: number; y: number }): void {
  run(`[YallInput]::Click(${Math.round(at.x)}, ${Math.round(at.y)})`);
}
