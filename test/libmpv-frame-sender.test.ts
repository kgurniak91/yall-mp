import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  FrameSenderLibmpv,
  FrameTarget,
  LibmpvFrameSender,
  PROBE_START_CHANNEL,
  READBACK_CHANNEL,
  SharedTextureApi
} from '../libmpv-frame-sender';
import {AttachRendererOptions, AttachResult, LibmpvEvent, RenderFrame, SharedBackendName} from '../libmpv-bridge';

const adapter = (software = false) => ({
  name: 'Test GPU', vendorId: 4318, deviceId: 7684, luid: '0:1', software, matched: true, selection: 'match'
});

interface FakeLibmpv extends FrameSenderLibmpv {
  attaches: Array<{ options: AttachRendererOptions; onFrame: (frame: RenderFrame) => void; result: AttachResult }>;
  emit(event: LibmpvEvent): void;
}

const fakeLibmpv = (opts: {
  d3d11?: boolean; shared?: SharedBackendName; software?: boolean; attachError?: { code: string; message: string };
} = {}): FakeLibmpv => {
  const listeners = new Set<(event: LibmpvEvent) => void>();
  const attaches: FakeLibmpv['attaches'] = [];
  let observeId = 0;
  return {
    attaches,
    sharedBackendName: () => opts.d3d11 === false ? null : opts.shared ?? 'd3d11-shared',
    attachRenderer: vi.fn(async (options: AttachRendererOptions, onFrame: (frame: RenderFrame) => void) => {
      if (opts.attachError && options.backend !== 'readback') {
        throw Object.assign(new Error(opts.attachError.message), {code: opts.attachError.code});
      }
      const result: AttachResult = {
        attachId: attaches.length + 1, backend: options.backend, impl: options.backend === 'readback' && opts.software ? 'sw' : 'd3d11',
        gpuWaitImpl: 'fence', adapter: adapter(opts.software)
      };
      attaches.push({options, onFrame, result});
      return result;
    }),
    resize: vi.fn(),
    releaseSlot: vi.fn(),
    detachRenderer: vi.fn(),
    reinitVideo: vi.fn().mockResolvedValue(undefined),
    getProperty: vi.fn((name: string) => Promise.resolve(({path: '/media/a.mp4', 'time-pos': 1.5, pause: false} as Record<string, unknown>)[name])),
    command: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue(null),
    observeProperty: vi.fn(() => ++observeId),
    unobserveProperty: vi.fn(),
    on: (_event: string, listener: (event: LibmpvEvent) => void) => listeners.add(listener),
    off: (_event: string, listener: (event: LibmpvEvent) => void) => listeners.delete(listener),
    emit: (event: LibmpvEvent) => listeners.forEach(l => l(event))
  } as unknown as FakeLibmpv;
};

const sharedFrame = (attachId: number, slotId = 0, serial = 1): RenderFrame =>
  ({attachId, slotId, serial, generation: 1, width: 640, height: 360, handle: Buffer.alloc(8)});

const readbackFrame = (attachId: number, width = 320, height = 180): RenderFrame =>
  ({attachId, slotId: -1, serial: 0, generation: 1, width, height, pixels: Buffer.alloc(width * height * 4)});

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('LibmpvFrameSender', () => {
  let target: FrameTarget & { send: ReturnType<typeof vi.fn> };
  let texture: { imported: Array<{ release: ReturnType<typeof vi.fn>; allReferencesReleased?: () => void }> } & SharedTextureApi;
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    target = {send: vi.fn(), mainFrame: {}};
    log = vi.fn();
    const imported: typeof texture.imported = [];
    texture = {
      imported,
      importSharedTexture: vi.fn((options) => {
        const entry = {release: vi.fn(), allReferencesReleased: options.allReferencesReleased};
        imported.push(entry);
        return entry;
      }),
      sendSharedTexture: vi.fn().mockResolvedValue(undefined)
    };
  });

  const create = (libmpv: FakeLibmpv, extra: Partial<ConstructorParameters<typeof LibmpvFrameSender>[0]> = {}) =>
    new LibmpvFrameSender({libmpv, webContents: target, log, sharedTexture: texture, ...extra});

  it('picks d3d11-shared for auto when the API supports it, readback otherwise', async () => {
    const gpu = fakeLibmpv({d3d11: true});
    await create(gpu).start({width: 800, height: 450, preferred: 'auto'});
    expect(gpu.attaches[0].options.backend).toBe('d3d11-shared');

    const noGpu = fakeLibmpv({d3d11: false});
    await create(noGpu).start({width: 800, height: 450, preferred: 'auto'});
    expect(noGpu.attaches[0].options.backend).toBe('readback');
  });

  it('picks iosurface-shared for auto on macOS', async () => {
    const libmpv = fakeLibmpv({shared: 'iosurface-shared'});
    await create(libmpv).start({width: 800, height: 450, preferred: 'auto'});
    expect(libmpv.attaches[0].options.backend).toBe('iosurface-shared');
  });

  it('logs the GL diagnostics of a shared backend when it attaches', async () => {
    const libmpv = fakeLibmpv({shared: 'iosurface-shared'});
    (libmpv.stats as ReturnType<typeof vi.fn>).mockReturnValue({glErrors: 2, note: 'GL 4.1 | Apple M1'});
    await create(libmpv).start({width: 800, height: 450, preferred: 'auto'});
    expect(log).toHaveBeenCalledWith('[libmpv] iosurface-shared attached: glErrors=2 GL 4.1 | Apple M1');
  });

  it('keeps readback when asked for it, whatever the platform offers', async () => {
    const libmpv = fakeLibmpv();
    await create(libmpv).start({width: 800, height: 450, preferred: 'readback'});
    expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['readback']);
  });

  it.each(['RENDER_INIT_FAILED', 'BACKEND_UNSUPPORTED'])('attaches readback and logs the reason when the shared attach fails with %s', async (code) => {
    const libmpv = fakeLibmpv({shared: 'iosurface-shared', attachError: {code, message: 'no usable GPU'}});
    const sender = create(libmpv);
    const result = await sender.start({width: 800, height: 450, preferred: 'auto'});
    expect(result.backend).toBe('readback');
    expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['readback']);
    expect(sender.stats().backend).toBe('readback');
    expect(sender.stats().fallbackReason).toBe('no usable GPU');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('iosurface-shared could not be attached (no usable GPU), using readback'));
    expect(libmpv.reinitVideo).not.toHaveBeenCalled();
  });

  it('falls back from an explicitly requested shared backend that cannot attach', async () => {
    const libmpv = fakeLibmpv({attachError: {code: 'BACKEND_UNSUPPORTED', message: 'not on this platform'}});
    expect((await create(libmpv).start({width: 800, height: 450, preferred: 'iosurface-shared'})).backend).toBe('readback');
  });

  it('does not hide attach errors that are not about the backend', async () => {
    const libmpv = fakeLibmpv({attachError: {code: 'DESTROYED', message: 'destroyed'}});
    await expect(create(libmpv).start({width: 800, height: 450, preferred: 'auto'})).rejects.toThrow('destroyed');
    expect(libmpv.attaches).toHaveLength(0);
  });

  it('imports macOS frames as an IOSurface and Windows frames as an NT handle', async () => {
    const handle = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const handleOf = () => (texture.importSharedTexture as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].textureInfo.handle;

    const mac = fakeLibmpv({shared: 'iosurface-shared'});
    await create(mac).start({width: 800, height: 450, preferred: 'auto'});
    mac.attaches[0].onFrame({...sharedFrame(1), handle});
    expect(handleOf()).toEqual({ioSurface: handle});

    const win = fakeLibmpv();
    await create(win).start({width: 800, height: 450, preferred: 'auto'});
    win.attaches[0].onFrame({...sharedFrame(1), handle});
    expect(handleOf()).toEqual({ntHandle: handle});
  });

  it('imports a dma-buf frame as a nativePixmap with the modifier as a decimal string', async () => {
    const libmpv = fakeLibmpv({shared: 'dmabuf-shared'});
    await create(libmpv).start({width: 800, height: 450, preferred: 'dmabuf-shared'});
    const dmabuf = {fd: 57, stride: 2560, offset: 0, size: 921600, modifier: '0'};
    libmpv.attaches[0].onFrame({...sharedFrame(1), handle: undefined, dmabuf});
    const info = (texture.importSharedTexture as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].textureInfo;
    expect(info).toEqual({
      pixelFormat: 'bgra', codedSize: {width: 640, height: 360},
      handle: {nativePixmap: {planes: [{fd: 57, stride: 2560, offset: 0, size: 921600}], modifier: '0', supportsZeroCopyWebGpuImport: false}}
    });
  });

  it('does not pick dmabuf-shared for auto, only on request', async () => {
    const libmpv = fakeLibmpv({d3d11: false});
    await create(libmpv).start({width: 800, height: 450, preferred: 'auto'});
    expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['readback']);
  });

  it('falls back to readback when Chromium cannot import the dma-buf on the first frame', async () => {
    const libmpv = fakeLibmpv({shared: 'dmabuf-shared'});
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'dmabuf-shared'});
    (texture.importSharedTexture as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Failed to import shared texture: GPU is not available');
    });
    libmpv.attaches[0].onFrame({...sharedFrame(1), handle: undefined, dmabuf: {fd: 57, stride: 2560, offset: 0, size: 921600, modifier: '0'}});
    await flush();
    expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['dmabuf-shared', 'readback']);
    expect(sender.stats().fallbackReason).toContain('GPU is not available');
    expect(libmpv.reinitVideo).toHaveBeenCalled();
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 0, 1);
  });

  it('resizes a shared backend to the canvas, not to a readback cap', async () => {
    const libmpv = fakeLibmpv({shared: 'iosurface-shared'});
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'auto'});
    sender.setCanvasSize(3000, 2000);
    expect(libmpv.resize).toHaveBeenCalledWith(3000, 2000);
  });

  it('passes the active GPU of getGPUInfo as the adapter', async () => {
    const libmpv = fakeLibmpv();
    const gpuInfo = {gpuDevice: [{vendorId: 1, deviceId: 2}, {vendorId: 4318, deviceId: 7684, active: true}]};
    await create(libmpv, {gpuInfo}).start({width: 800, height: 450, preferred: 'd3d11-shared'});
    expect(libmpv.attaches[0].options.adapter).toEqual({vendorId: 4318, deviceId: 7684});
  });

  it('drops frames of a stale attach without importing them, and releases their slot', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(99, 2, 7));
    expect(texture.importSharedTexture).not.toHaveBeenCalled();
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(99, 2, 7);
    expect(sender.stats().staleDropped).toBe(1);
  });

  it('imports and sends a shared frame, and releases the slot when Chromium drops its references', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(1, 3, 5));
    await flush();
    expect(texture.sendSharedTexture).toHaveBeenCalledTimes(1);
    expect(texture.imported[0].release).toHaveBeenCalledTimes(1);
    expect(libmpv.releaseSlot).not.toHaveBeenCalled();
    texture.imported[0].allReferencesReleased!();
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 3, 5);
    expect(sender.stats().sent).toBe(1);
  });

  it('releases the imported texture and the slot once when the send is rejected', async () => {
    const libmpv = fakeLibmpv();
    (texture.sendSharedTexture as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('frame destroyed'));
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    // A first frame that is rejected falls back; use a second one to look at the plain failure path.
    libmpv.attaches[0].onFrame(sharedFrame(1, 0, 1));
    await flush();
    const failuresAfterFirst = sender.stats().sendFailures;
    expect(failuresAfterFirst).toBe(1);
    expect(texture.imported[0].release).toHaveBeenCalledTimes(1);
    expect(libmpv.releaseSlot).toHaveBeenCalledTimes(1);
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 0, 1);
  });

  it('does not fall back when the page has no receiver yet', async () => {
    const libmpv = fakeLibmpv();
    (texture.sendSharedTexture as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No receiver registered'));
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(1));
    await flush();
    expect(libmpv.attaches).toHaveLength(1);
    expect(sender.stats().fallbackReason).toBeNull();
  });

  it('switches to readback and logs when the first frame cannot be imported', async () => {
    const libmpv = fakeLibmpv();
    (texture.importSharedTexture as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Unable to duplicate handle');
    });
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(1, 1, 4));
    await flush();

    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 1, 4);
    expect(libmpv.attaches).toHaveLength(2);
    expect(libmpv.attaches[1].options.backend).toBe('readback');
    expect(libmpv.reinitVideo).toHaveBeenCalledTimes(1);
    expect(sender.stats().fallbackReason).toBe('Unable to duplicate handle');
    expect(sender.stats().backend).toBe('readback');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shared-texture import failed on first frame (Unable to duplicate handle), switching to readback; backend=d3d11-shared platform=' + process.platform + ' adapter=Test GPU vendor/device=4318/7684'));

    // Frames of the abandoned shared attach are now stale.
    libmpv.attaches[0].onFrame(sharedFrame(1, 2, 9));
    expect(texture.importSharedTexture).toHaveBeenCalledTimes(1);
    expect(sender.stats().staleDropped).toBe(1);
  });

  describe('video output failing during the switch to readback', () => {
    const failFirstImport = async (libmpv: FakeLibmpv): Promise<LibmpvFrameSender> => {
      (texture.importSharedTexture as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('GPU is not available');
      });
      const sender = create(libmpv);
      await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
      libmpv.attaches[0].onFrame(sharedFrame(1));
      return sender;
    };
    const voFailed: LibmpvEvent = {event: 'end-file', reason: 'error', error: {code: 'VO_INIT_FAILED', message: 'video output initialization failed'}};

    it('reloads the file at the same position when the video output gave up', async () => {
      const libmpv = fakeLibmpv();
      await failFirstImport(libmpv);
      libmpv.emit(voFailed);
      await flush();
      expect(libmpv.command).toHaveBeenCalledWith(['loadfile', '/media/a.mp4', 'replace', '-1', 'start=1.5,pause=no']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('reloading the file at 1.50 s'));

      // One repair per switch.
      libmpv.emit(voFailed);
      await flush();
      expect(libmpv.command).toHaveBeenCalledTimes(1);
    });

    it('ignores other end-file events', async () => {
      const libmpv = fakeLibmpv();
      await failFirstImport(libmpv);
      libmpv.emit({event: 'end-file', reason: 'eof'});
      libmpv.emit({event: 'end-file', reason: 'error', error: {code: 'LOADING_FAILED', message: 'loading failed'}});
      await flush();
      expect(libmpv.command).not.toHaveBeenCalled();
    });

    it('does nothing without a fallback', async () => {
      const libmpv = fakeLibmpv();
      const sender = create(libmpv);
      await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
      libmpv.attaches[0].onFrame(sharedFrame(1));
      libmpv.emit(voFailed);
      await flush();
      expect(libmpv.command).not.toHaveBeenCalled();
    });

    it('stop() cancels a pending repair', async () => {
      const libmpv = fakeLibmpv();
      (await failFirstImport(libmpv)).stop();
      libmpv.emit(voFailed);
      await flush();
      expect(libmpv.command).not.toHaveBeenCalled();
    });
  });

  it('only counts import failures after the first frame', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(1));
    (texture.importSharedTexture as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('later failure');
    });
    libmpv.attaches[0].onFrame(sharedFrame(1, 1, 2));
    expect(libmpv.attaches).toHaveLength(1);
    expect(sender.stats().importFailures).toBe(1);
    expect(sender.stats().fallbackReason).toBeNull();
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 1, 2);
  });

  it('simulateImportFailure forces the fallback on the first frame', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv, {simulateImportFailure: true});
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    libmpv.attaches[0].onFrame(sharedFrame(1));
    expect(libmpv.attaches[1].options.backend).toBe('readback');
    expect(texture.importSharedTexture).not.toHaveBeenCalled();
  });

  it('forwards readback frames over IPC, sized by computeReadbackSize', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 3200, height: 1800, preferred: 'readback'});
    expect(libmpv.attaches[0].options).toMatchObject({backend: 'readback', width: 1280, height: 720});

    libmpv.attaches[0].onFrame(readbackFrame(1, 1280, 720));
    expect(target.send).toHaveBeenCalledWith(READBACK_CHANNEL, expect.objectContaining({attachId: 1, width: 1280, height: 720}));
    expect(sender.stats().sent).toBe(1);
  });

  it('uses the smaller cap once the adapter turns out to be software', async () => {
    const libmpv = fakeLibmpv({software: true});
    await create(libmpv).start({width: 1600, height: 900, preferred: 'readback'});
    expect(libmpv.resize).toHaveBeenCalledWith(960, 540);
  });

  it('follows the canvas size and the video native size in readback mode', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 1600, height: 900, preferred: 'readback'});
    sender.setCanvasSize(800, 450);
    expect(libmpv.resize).toHaveBeenLastCalledWith(800, 450);
    libmpv.emit({event: 'property-change', id: 1, name: 'dwidth', data: 640});
    libmpv.emit({event: 'property-change', id: 2, name: 'dheight', data: 360});
    expect(libmpv.resize).toHaveBeenLastCalledWith(640, 360);
  });

  it('passes the canvas size straight through in shared mode', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    sender.setCanvasSize(1920, 1080);
    expect(libmpv.resize).toHaveBeenCalledWith(1920, 1080);
  });

  it('detaches on stop and drops later frames', async () => {
    const libmpv = fakeLibmpv();
    const sender = create(libmpv);
    await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
    sender.stop();
    expect(libmpv.detachRenderer).toHaveBeenCalledTimes(1);
    libmpv.attaches[0].onFrame(sharedFrame(1, 2, 3));
    expect(texture.importSharedTexture).not.toHaveBeenCalled();
    expect(libmpv.releaseSlot).toHaveBeenCalledWith(1, 2, 3);
    expect(sender.stats().staleDropped).toBe(1);
    expect(libmpv.unobserveProperty).toHaveBeenCalledTimes(2);
  });

  describe('waitForFrame', () => {
    it('resolves at once when more frames were already sent', async () => {
      const libmpv = fakeLibmpv();
      const sender = create(libmpv);
      await sender.start({width: 320, height: 180, preferred: 'readback'});
      libmpv.attaches[0].onFrame(readbackFrame(1));
      await expect(sender.waitForFrame(0, 1000)).resolves.toBe(true);
    });

    it('resolves when a frame beyond the baseline is sent', async () => {
      const libmpv = fakeLibmpv();
      const sender = create(libmpv);
      await sender.start({width: 320, height: 180, preferred: 'readback'});
      libmpv.attaches[0].onFrame(readbackFrame(1));
      const waiting = sender.waitForFrame(1, 1000);
      libmpv.attaches[0].onFrame(readbackFrame(1));
      await expect(waiting).resolves.toBe(true);
    });

    it('counts shared frames too', async () => {
      const libmpv = fakeLibmpv();
      const sender = create(libmpv);
      await sender.start({width: 640, height: 360, preferred: 'd3d11-shared'});
      const waiting = sender.waitForFrame(0, 1000);
      libmpv.attaches[0].onFrame(sharedFrame(1));
      await expect(waiting).resolves.toBe(true);
    });

    it('resolves false on timeout', async () => {
      vi.useFakeTimers();
      try {
        const sender = create(fakeLibmpv());
        await sender.start({width: 320, height: 180, preferred: 'readback'});
        const waiting = sender.waitForFrame(0, 1000);
        await vi.advanceTimersByTimeAsync(1001);
        await expect(waiting).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves false on stop', async () => {
      const sender = create(fakeLibmpv());
      await sender.start({width: 320, height: 180, preferred: 'readback'});
      const waiting = sender.waitForFrame(0, 60000);
      sender.stop();
      await expect(waiting).resolves.toBe(false);
    });
  });
  describe('dmabuf frames and the validation of the first frames', () => {
    // BGRA of five points: all black, or one lit pixel
    const blackProbe = Array(20).fill(0);
    const litProbe = [0, 0, 0, 255, 10, 20, 30, 255, ...Array(12).fill(0)];
    const dmabufFrame = (probe: number[] | undefined, slotId = 0, serial = 1): RenderFrame => ({
      attachId: 1, slotId, serial, generation: 1, width: 640, height: 360, probe,
      dmabuf: {fd: 42, stride: 2560, offset: 0, size: 921600, modifier: '0'}
    });
    const started = async (extra: Partial<ConstructorParameters<typeof LibmpvFrameSender>[0]> = {}) => {
      const libmpv = fakeLibmpv({shared: 'dmabuf-shared'});
      const sender = create(libmpv, extra);
      await sender.start({width: 800, height: 450, preferred: 'dmabuf-shared'});
      return {libmpv, sender};
    };

    it('imports a dma-buf frame as a nativePixmap and asks the page to probe', async () => {
      const {libmpv} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      const info = (texture.importSharedTexture as ReturnType<typeof vi.fn>).mock.calls[0][0].textureInfo;
      expect(info.handle).toEqual({nativePixmap: {
        planes: [{fd: 42, stride: 2560, offset: 0, size: 921600}], modifier: '0', supportsZeroCopyWebGpuImport: false
      }});
      expect(target.send).toHaveBeenCalledWith(PROBE_START_CHANNEL, {attachId: 1, frames: 30});
    });

    it('falls back after three black page probes while the host rendered a picture', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      expect(libmpv.attaches).toHaveLength(1);
      sender.reportPageProbe(true);
      await flush();
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['dmabuf-shared', 'readback']);
      expect(sender.stats().fallbackReason).toContain('page read black');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('imported frames are black'));
      expect(libmpv.reinitVideo).toHaveBeenCalled();
    });

    it('does not fall back when the page shows a picture', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      sender.reportPageProbe(true);
      sender.reportPageProbe(false);
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      await flush();
      expect(libmpv.attaches).toHaveLength(1);
    });

    it('is inconclusive while the video itself is black, and accepts after the window', async () => {
      vi.useFakeTimers();
      try {
        const {libmpv, sender} = await started();
        libmpv.attaches[0].onFrame(dmabufFrame(blackProbe));
        for (let i = 0; i < 10; i++) {
          sender.reportPageProbe(true);
        }
        await vi.advanceTimersByTimeAsync(5001);
        expect(libmpv.attaches).toHaveLength(1);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('not confirmed within 5000 ms, accepting'));
        // after the window nothing is checked any more
        libmpv.attaches[0].onFrame(dmabufFrame(litProbe, 1, 2));
        for (let i = 0; i < 5; i++) {
          sender.reportPageProbe(true);
        }
        expect(libmpv.attaches).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a later lit host frame turns earlier black samples into evidence', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(blackProbe));
      sender.reportPageProbe(true);
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe, 1, 2));
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      await flush();
      expect(libmpv.attaches[1]?.options.backend).toBe('readback');
    });

    it('simulateBlackFrames forces the black fallback without a page', async () => {
      const {libmpv, sender} = await started({simulateBlackFrames: true});
      for (let i = 0; i < 3; i++) {
        libmpv.attaches[0].onFrame(dmabufFrame(undefined, i, i + 1));
      }
      await flush();
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['dmabuf-shared', 'readback']);
      expect(sender.stats().fallbackReason).toContain('page read black');
    });

    it('goes to readback when the GPU process is gone, and ignores it on readback', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      sender.gpuProcessGone('crashed');
      await flush();
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['dmabuf-shared', 'readback']);
      expect(sender.stats().fallbackReason).toBe('GPU process gone (crashed)');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('the GPU process is gone'));
      sender.gpuProcessGone('crashed');
      await flush();
      expect(libmpv.attaches).toHaveLength(2);
    });

    it('a dmabuf attach failure falls back to readback', async () => {
      const libmpv = fakeLibmpv({shared: 'dmabuf-shared', attachError: {code: 'RENDER_INIT_FAILED', message: 'no render node'}});
      const result = await create(libmpv).start({width: 800, height: 450, preferred: 'dmabuf-shared'});
      expect(result.backend).toBe('readback');
    });
  });
});
