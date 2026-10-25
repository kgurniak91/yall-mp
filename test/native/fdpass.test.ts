import {spawn, spawnSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {createHostAddon, FdPassAddon} from '../../libmpv-host';
import {ROOT, SAMPLE_MP4, sleep, waitFor} from './support/native';

// yall_fdpass receives the descriptors that yall-mpv-host sends over its fd 4. Both are Linux-only; a machine
// where the addon was not built skips (YALL_NATIVE_REQUIRED=1, set in CI, makes that a failure).
const buildDir = path.join(ROOT, 'native', 'yall-libmpv', 'build', 'Release');
const hostPath = path.join(buildDir, 'yall-mpv-host');
const addonPath = path.join(buildDir, 'yall_fdpass.node');
const required = process.env['YALL_NATIVE_REQUIRED'] === '1';

const loadAddon = (): FdPassAddon => {
  const module = {exports: {} as unknown};
  process.dlopen(module as NodeJS.Module, addonPath);
  return module.exports as FdPassAddon;
};

const openFds = (): number => fs.readdirSync('/proc/self/fd').length;

if (process.platform === 'linux' && (fs.existsSync(addonPath) || required)) {
  describe('descriptor passing', () => {
    const addon = loadAddon();
    const cleanup: Array<() => void> = [];

    afterEach(() => {
      cleanup.splice(0).reverse().forEach(fn => fn());
    });

    /** A started receiver on a fresh channel; collects what arrives. */
    const channel = () => {
      const {parentFd, childFd} = addon.createFdChannel();
      const received: Array<{ fd: number; meta: string }> = [];
      const receiverId = addon.startReceiver(parentFd, (fd, meta) => received.push({fd, meta}));
      let open = true;
      const close = (): void => {
        if (open) {
          open = false;
          addon.stopReceiver(receiverId);
          addon.closeFd(parentFd);
          addon.closeFd(childFd);
          received.forEach(r => r.fd >= 0 && addon.closeFd(r.fd));
        }
      };
      cleanup.push(close);
      return {parentFd, childFd, received, close};
    };

    const scratchFile = (content: string): number => {
      const file = path.join(os.tmpdir(), `yall-fdpass-${process.pid}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(file, content);
      const fd = fs.openSync(file, 'r');
      fs.unlinkSync(file);
      cleanup.push(() => fs.closeSync(fd));
      return fd;
    };

    it('passes a file descriptor with its text and the received copy reads the same file', async () => {
      const ch = channel();
      const fd = scratchFile('dma-buf stand-in');
      addon.sendFd(ch.childFd, fd, JSON.stringify({attachId: 1, slotId: 2}));
      await waitFor(() => ch.received.length === 1, 5000, 'the descriptor');
      const [got] = ch.received;
      expect(got.fd).toBeGreaterThanOrEqual(0);
      expect(got.fd).not.toBe(fd);
      expect(JSON.parse(got.meta)).toEqual({attachId: 1, slotId: 2});
      expect(addon.readFd(got.fd, 64).toString()).toBe('dma-buf stand-in');
    });

    it('delivers text-only messages with fd -1 and keeps the order', async () => {
      const ch = channel();
      addon.sendFd(ch.childFd, -1, 'first');
      addon.sendFd(ch.childFd, scratchFile('x'), 'second');
      addon.sendFd(ch.childFd, -1, 'third');
      await waitFor(() => ch.received.length === 3, 5000, 'three messages');
      expect(ch.received.map(r => r.meta)).toEqual(['first', 'second', 'third']);
      expect(ch.received.map(r => r.fd >= 0)).toEqual([false, true, false]);
    });

    it('receives the memfd that the host sends over its fd 4', async () => {
      if (!fs.existsSync(hostPath)) {
        expect.fail(`the host is not built: ${hostPath}`);
      }
      const ch = channel();
      const host = spawn(hostPath, ['--fd-selftest'], {stdio: ['ignore', 'pipe', 'inherit', 'ignore', ch.childFd]});
      let output = '';
      host.stdout!.on('data', (chunk: Buffer) => output += chunk.toString());
      const code = await new Promise<number | null>(resolve => host.once('exit', resolve));
      expect(code, output).toBe(0);
      await waitFor(() => ch.received.length === 1, 5000, 'the descriptor from the host');
      expect(JSON.parse(ch.received[0].meta)).toEqual({slotId: 7});
      expect(addon.readFd(ch.received[0].fd, 64).toString()).toBe('yall-fd-test');
    });

    it('lets the host tell that it was started without a channel', () => {
      if (!fs.existsSync(hostPath)) {
        expect.fail(`the host is not built: ${hostPath}`);
      }
      const run = spawnSync(hostPath, ['--fd-selftest'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'ignore']});
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout)).toMatchObject({ok: false});
    });

    it('stops the receiver when the peer goes away, and stopReceiver still returns', async () => {
      const {parentFd, childFd} = addon.createFdChannel();
      const receiverId = addon.startReceiver(parentFd, () => undefined);
      addon.closeFd(childFd);
      await sleep(50);
      addon.stopReceiver(receiverId);
      addon.closeFd(parentFd);
    });

    it('does not leak descriptors over 20 channels', async () => {
      const before = openFds();
      for (let i = 0; i < 20; i++) {
        const ch = channel();
        addon.sendFd(ch.childFd, scratchFile('leak'), `{"i":${i}}`);
        await waitFor(() => ch.received.length === 1, 5000, 'the descriptor');
        ch.close();
        cleanup.splice(0).reverse().forEach(fn => fn());
      }
      expect(openFds()).toBe(before);
    });

    it('does not leak descriptors over 20 host start/stop cycles', async () => {
      if (!fs.existsSync(hostPath)) {
        expect.fail(`the host is not built: ${hostPath}`);
      }
      const hostAddon = createHostAddon({hostPath, fdpass: addon});
      const loaded = hostAddon.loadLibrary(process.env['YALL_LIBMPV_PATH'] || 'libmpv.so.2');
      expect(loaded.apiVersion[0]).toBeGreaterThanOrEqual(2);
      const run = async (): Promise<void> => {
        const core = new hostAddon.MpvCore();
        core.setOption('vo', 'null');
        core.setOption('ao', 'null');
        await core.initialize();
        await core.command(['loadfile', SAMPLE_MP4, 'replace']);
        await core.destroy();
      };
      await run(); // warm-up: node's own lazily opened descriptors
      const before = openFds();
      for (let i = 0; i < 20; i++) {
        await run();
      }
      expect(openFds()).toBe(before);
    });
  });
} else {
  describe.skip('descriptor passing (Linux only, needs the built yall_fdpass addon)', () => undefined);
}
