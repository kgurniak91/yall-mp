import {spawnSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {ROOT} from './support/native';

// The EGL/GBM core of the dma-buf backend, exercised through the host's `--egl-selftest`. Machines
// without a usable DRM node (hosted CI, containers) get a truthful error instead of a crash.
const hostPath = path.join(ROOT, 'native', 'yall-libmpv', 'build', 'Release', 'yall-mpv-host');

interface SelfTest {
  ok: boolean;
  error?: string;
  node?: string;
  renderNode?: boolean;
  glRenderer?: string;
  stride?: number;
  modifier?: string;
  pixel?: number[];
  glErrors?: number;
}

const runSelfTest = (): SelfTest => {
  const run = spawnSync(hostPath, ['--egl-selftest'], {encoding: 'utf8', timeout: 20000});
  return JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}');
};

if (process.platform === 'linux' && fs.existsSync(hostPath)) {
  describe('EGL/GBM dma-buf core', () => {
    it('renders into a dma-buf backed target, or reports why it cannot', () => {
      const result = runSelfTest();
      if (!result.ok) {
        expect(result.error, 'a failed self-test must say why').toBeTruthy();
        console.log(`dma-buf core unavailable here: ${result.error}`);
        return;
      }
      expect(result.node).toMatch(/^\/dev\/dri\//);
      expect(result.glErrors).toBe(0);
      expect(result.stride).toBeGreaterThanOrEqual(64 * 4);
      expect(result.modifier).toMatch(/^\d+$/);
      // BGRA bytes of a red clear
      expect(result.pixel).toEqual([0, 0, 255, 255]);
    });

    it('has no link-time dependency on EGL or GBM, so readback hosts still start without them', () => {
      const ldd = spawnSync('ldd', [hostPath], {encoding: 'utf8'});
      expect(ldd.stdout).not.toMatch(/libEGL|libgbm|libdrm/);
    });
  });
} else {
  describe.skip('EGL/GBM dma-buf core (Linux only, needs the built host)', () => undefined);
}
