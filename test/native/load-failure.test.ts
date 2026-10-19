import {expect, it} from 'vitest';
import {LibmpvError, loadLibmpv} from '../../libmpv-bridge';
import {describeAddon} from './support/native';

// Runs in its own file (own process): once a libmpv is loaded, a different path can only report
// "already loaded", so the not-found case has to be seen before any successful load.
describeAddon('libmpv loading failures', (addon) => {
  it('reports a missing library with every tried path and keeps the process alive', () => {
    try {
      loadLibmpv(addon, ['C:/definitely/not/here/libmpv-2.dll', '/definitely/not/here/libmpv.so.2']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LibmpvError);
      expect((error as LibmpvError).code).toBe('LIB_NOT_FOUND');
      expect((error as LibmpvError).tried).toHaveLength(2);
      expect((error as LibmpvError).message).toContain('not');
    }
    expect(addon.apiVersion()).toBeNull();
  });

  it('rejects a file that is not libmpv without loading it', () => {
    try {
      loadLibmpv(addon, [process.execPath]);
      expect.unreachable();
    } catch (error) {
      expect((error as LibmpvError).code).toBe('LIB_NOT_FOUND');
      expect((error as LibmpvError).tried[0].error).toContain('missing export');
    }
    expect(addon.apiVersion()).toBeNull();
  });
});
