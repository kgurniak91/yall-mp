import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  backendAfterGpuLoss,
  FrameSenderLibmpv,
  FrameTarget,
  LibmpvFrameSender,
  PreferredBackend,
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
    expect(libmpv.unobserveProperty).toHaveBeenCalledTimes(3);
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
  describe.each(['d3d11-shared', 'iosurface-shared', 'dmabuf-shared'] as const)('%s: validation of the first frames', backend => {
    // BGRA of five points: all black, or one lit pixel
    const blackProbe = Array(20).fill(0);
    const litProbe = [0, 0, 0, 255, 10, 20, 30, 255, ...Array(12).fill(0)];
    const dmabufFrame = (probe: number[] | undefined, slotId = 0, serial = 1): RenderFrame => ({
      attachId: 1, slotId, serial, generation: 1, width: 640, height: 360, probe,
      ...(backend === 'dmabuf-shared' ? {dmabuf: {fd: 42, stride: 2560, offset: 0, size: 921600, modifier: '0'}} : {handle: Buffer.alloc(8)})
    });
    const started = async (extra: Partial<ConstructorParameters<typeof LibmpvFrameSender>[0]> = {}) => {
      const libmpv = fakeLibmpv({shared: backend});
      const sender = create(libmpv, extra);
      await sender.start({width: 800, height: 450, preferred: backend});
      return {libmpv, sender};
    };

    it('imports the frame and asks the page to probe', async () => {
      const {libmpv} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      const info = (texture.importSharedTexture as ReturnType<typeof vi.fn>).mock.calls[0][0].textureInfo;
      if (backend === 'dmabuf-shared') {
        expect(info.handle).toEqual({nativePixmap: {
          planes: [{fd: 42, stride: 2560, offset: 0, size: 921600}], modifier: '0', supportsZeroCopyWebGpuImport: false
        }});
      } else {
        expect(info.handle).toEqual(backend === 'iosurface-shared' ? {ioSurface: expect.anything()} : {ntHandle: expect.anything()});
      }
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
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, 'readback']);
      expect(sender.stats().fallbackReason).toContain('page read black');
      expect(sender.stats().validation).toBe('black');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('imported frames are black'));
      expect(libmpv.reinitVideo).toHaveBeenCalled();
    });

    it('does not fall back when the page shows a picture', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      expect(sender.stats().validation).toBe('pending');
      sender.reportPageProbe(true);
      sender.reportPageProbe(false);
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      sender.reportPageProbe(true);
      await flush();
      expect(libmpv.attaches).toHaveLength(1);
      expect(sender.stats().validation).toBe('confirmed');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('confirmed by the page'));
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
        expect(sender.stats().validation).toBe('accepted');
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
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, 'readback']);
      expect(sender.stats().fallbackReason).toContain('page read black');
    });

    it('goes to readback when the GPU process is gone, and ignores it on readback', async () => {
      const {libmpv, sender} = await started();
      libmpv.attaches[0].onFrame(dmabufFrame(litProbe));
      sender.gpuProcessGone('crashed');
      await flush();
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, 'readback']);
      expect(sender.stats().fallbackReason).toBe('GPU process gone (crashed)');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('the GPU process is gone'));
      sender.gpuProcessGone('crashed');
      await flush();
      expect(libmpv.attaches).toHaveLength(2);
    });

    it('an attach failure falls back to readback', async () => {
      const libmpv = fakeLibmpv({shared: backend, attachError: {code: 'RENDER_INIT_FAILED', message: 'no render node'}});
      const result = await create(libmpv).start({width: 800, height: 450, preferred: backend});
      expect(result.backend).toBe('readback');
    });
  });

  describe.each(['d3d11-shared', 'iosurface-shared'] as const)('%s: the GPU device behind the attach is lost', backend => {
    const lostFrame = (attachId: number, reason = 'DEVICE_REMOVED 0x887A0005'): RenderFrame =>
      ({attachId, slotId: -1, serial: 0, generation: 0, width: 0, height: 0, lost: reason});
    const started = async (preferredAfter: () => PreferredBackend = () => backend) => {
      const libmpv = fakeLibmpv({shared: backend});
      const sender = create(libmpv, {preferredAfterDeviceLoss: preferredAfter});
      await sender.start({width: 800, height: 450, preferred: backend});
      return {libmpv, sender};
    };
    const lose = async (libmpv: FakeLibmpv, attachId: number) => {
      libmpv.attaches[attachId - 1].onFrame(lostFrame(attachId));
      await flush();
    };

    it('attaches the preferred backend again and re-creates the video output', async () => {
      const {libmpv, sender} = await started();
      await lose(libmpv, 1);
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, backend]);
      expect(libmpv.reinitVideo).toHaveBeenCalledTimes(1);
      expect(sender.stats().fallbackReason).toBe('GPU device lost (DEVICE_REMOVED 0x887A0005)');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('the GPU device was lost'));
    });

    it('goes to readback when the policy says the GPU is not trusted anymore', async () => {
      const {libmpv} = await started(() => 'readback');
      await lose(libmpv, 1);
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, 'readback']);
    });

    it('uses readback when the new shared attach fails', async () => {
      const {libmpv} = await started();
      (libmpv.attachRenderer as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        throw Object.assign(new Error('device still resetting'), {code: 'RENDER_INIT_FAILED'});
      });
      await lose(libmpv, 1);
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, 'readback']);
    });

    it('ignores a lost frame of an attach that was replaced', async () => {
      const {libmpv} = await started();
      await lose(libmpv, 1);
      await lose(libmpv, 1);
      expect(libmpv.attaches).toHaveLength(2);
    });

    it('stays on readback once the device was lost three times within a minute', async () => {
      const {libmpv} = await started();
      for (let attachId = 1; attachId <= 4; attachId++) {
        await lose(libmpv, attachId);
      }
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual([backend, backend, backend, backend, 'readback']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('staying on readback'));
    });

    it('simulateDeviceLost asks the core for a lost frame of the current attach', async () => {
      const {libmpv, sender} = await started();
      expect(sender.simulateDeviceLost()).toBe(false);
      libmpv.simulateDeviceLost = vi.fn().mockReturnValue(true);
      expect(sender.simulateDeviceLost()).toBe(true);
      expect(libmpv.simulateDeviceLost).toHaveBeenCalledWith(1);
    });
  });

  describe('HDR tone mapping on the software renderer', () => {
    const gamma = async (libmpv: FakeLibmpv, value: unknown) => {
      libmpv.emit({event: 'property-change', name: 'video-params/gamma', data: value} as LibmpvEvent);
      await flush();
    };
    const filterCommands = (libmpv: FakeLibmpv) =>
      (libmpv.command as ReturnType<typeof vi.fn>).mock.calls.map(([args]) => args as string[]).filter(args => args[0] === 'vf');
    const names = (libmpv: FakeLibmpv) => filterCommands(libmpv).map(args => args.slice(0, 2).join(' '));
    const startedSoftware = async (opts: Parameters<typeof fakeLibmpv>[0] = {software: true}) => {
      const libmpv = fakeLibmpv(opts);
      const sender = create(libmpv);
      await sender.start({width: 800, height: 450, preferred: 'readback'});
      return {libmpv, sender};
    };
    // A libmpv whose ffmpeg has no zscale: only the graph that does not use it is accepted
    const withoutZscale = (libmpv: FakeLibmpv) => (libmpv.command as ReturnType<typeof vi.fn>).mockImplementation(async (args: string[]) => {
      if (args[0] === 'vf' && args[1] === 'add' && args[2].includes('zscale')) {
        throw new Error('error running command');
      }
      return undefined;
    });

    it('observes the transfer function of the file', async () => {
      const {libmpv} = await startedSoftware();
      expect(libmpv.observeProperty).toHaveBeenCalledWith('video-params/gamma');
    });

    it.each(['pq', 'hlg'])('adds the filter for a %s source', async (value) => {
      const {libmpv} = await startedSoftware();
      await gamma(libmpv, value);
      expect(filterCommands(libmpv)).toEqual([['vf', 'add', expect.stringContaining('@yall-tonemap:lavfi=[zscale')]]);
    });

    it('leaves an SDR source alone and does not add the filter twice', async () => {
      const {libmpv} = await startedSoftware();
      await gamma(libmpv, 'bt.1886');
      await gamma(libmpv, 'srgb');
      await gamma(libmpv, null);
      expect(filterCommands(libmpv)).toEqual([]);
      await gamma(libmpv, 'pq');
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv)).toHaveLength(1);
    });

    it('takes the filter out when the next file is SDR', async () => {
      const {libmpv} = await startedSoftware();
      await gamma(libmpv, 'pq');
      await gamma(libmpv, 'bt.1886');
      expect(names(libmpv)).toEqual(['vf add', 'vf remove']);
      expect(filterCommands(libmpv)[1][2]).toBe('@yall-tonemap');
    });

    it('does not touch the picture on the GPU renderers, which tone-map themselves', async () => {
      const {libmpv} = await startedSoftware({d3d11: true});
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv)).toEqual([]);
    });

    it('picks the filter up when HDR was already on screen before a software attach (fallback from a GPU backend)', async () => {
      const libmpv = fakeLibmpv({d3d11: true});
      const sender = create(libmpv);
      await sender.start({width: 800, height: 450, preferred: 'd3d11-shared'});
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv)).toEqual([]);
      (libmpv.attachRenderer as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options: AttachRendererOptions, onFrame: (frame: RenderFrame) => void) => {
        const result: AttachResult = {attachId: 2, backend: options.backend, impl: 'sw', gpuWaitImpl: 'fence', adapter: adapter(true)};
        libmpv.attaches.push({options, onFrame, result});
        return result;
      });
      sender.gpuProcessGone('test');
      await flush();
      expect(names(libmpv)).toEqual(['vf add']);
    });

    it('uses the lookup table graph when this libmpv has no zscale', async () => {
      const {libmpv} = await startedSoftware();
      withoutZscale(libmpv);
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv).map(args => args[2].includes('zscale') ? 'zscale' : 'lut')).toEqual(['zscale', 'lut']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("'zscale' was refused"));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('(lut;'));
      // the next file starts with the graph that works
      await gamma(libmpv, 'bt.1886');
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv).filter(args => args[1] === 'add').map(args => args[2].includes('zscale') ? 'zscale' : 'lut'))
        .toEqual(['zscale', 'lut', 'lut']);
    });

    it('leaves HLG alone when only the lookup table graph is available (it does PQ only)', async () => {
      const {libmpv} = await startedSoftware();
      withoutZscale(libmpv);
      await gamma(libmpv, 'hlg');
      expect(filterCommands(libmpv)).toHaveLength(1);
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('not available'));
      // a later PQ file still gets its filter
      await gamma(libmpv, 'bt.1886');
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv).filter(args => args[1] === 'add')).toHaveLength(2);
    });

    it('gives up quietly when no graph is available in this libmpv', async () => {
      const {libmpv} = await startedSoftware();
      (libmpv.command as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('error running command'));
      await gamma(libmpv, 'pq');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('not available in this libmpv'));
      const tried = filterCommands(libmpv).length;
      await gamma(libmpv, 'bt.1886');
      await gamma(libmpv, 'pq');
      expect(filterCommands(libmpv)).toHaveLength(tried);
    });
  });

  describe('checkAfterResume', () => {
    const videoSize = (libmpv: FakeLibmpv) => {
      libmpv.emit({event: 'property-change', name: 'dwidth', data: 640} as LibmpvEvent);
      libmpv.emit({event: 'property-change', name: 'dheight', data: 360} as LibmpvEvent);
    };
    // A redraw that is answered with a frame of the current attach, like the render thread does.
    const answering = (libmpv: FakeLibmpv) => vi.fn(() => {
      const current = libmpv.attaches[libmpv.attaches.length - 1];
      setImmediate(() => current.onFrame(readbackFrame(current.result.attachId)));
      return true;
    });
    const startedOn = async (backend: 'readback' | 'd3d11-shared', preferredAfter: () => PreferredBackend = () => 'd3d11-shared') => {
      const libmpv = fakeLibmpv();
      const sender = create(libmpv, {preferredAfterDeviceLoss: preferredAfter});
      await sender.start({width: 800, height: 450, preferred: backend});
      videoSize(libmpv);
      return {libmpv, sender};
    };

    it('is ok when the redraw produces a frame', async () => {
      const {libmpv, sender} = await startedOn('readback');
      libmpv.redraw = answering(libmpv);
      expect(await sender.checkAfterResume(500)).toBe('ok');
      expect(libmpv.redraw).toHaveBeenCalledTimes(1);
      expect(libmpv.attaches).toHaveLength(1);
    });

    it('skips when nothing is attached, the core cannot redraw, or the file has no video', async () => {
      const idle = create(fakeLibmpv());
      expect(await idle.checkAfterResume(20)).toBe('skipped');

      const {libmpv, sender} = await startedOn('readback');
      expect(await sender.checkAfterResume(20)).toBe('skipped');
      expect(libmpv.attaches).toHaveLength(1);

      const noVideo = fakeLibmpv();
      const audioOnly = create(noVideo);
      await audioOnly.start({width: 800, height: 450, preferred: 'readback'});
      noVideo.redraw = vi.fn().mockReturnValue(true);
      expect(await audioOnly.checkAfterResume(20)).toBe('skipped');
      expect(noVideo.redraw).not.toHaveBeenCalled();
    });

    it('attaches the preferred shared backend again when no frame comes back', async () => {
      const {libmpv, sender} = await startedOn('d3d11-shared');
      libmpv.redraw = vi.fn().mockReturnValue(true);
      expect(await sender.checkAfterResume(20)).toBe('reattached');
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['d3d11-shared', 'd3d11-shared']);
      expect(libmpv.reinitVideo).toHaveBeenCalledTimes(1);
      expect(sender.stats().fallbackReason).toBe('no frames after resume');
    });

    it('rebuilds a readback attach as readback', async () => {
      const {libmpv, sender} = await startedOn('readback');
      libmpv.redraw = vi.fn().mockReturnValue(true);
      expect(await sender.checkAfterResume(20)).toBe('reattached');
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['readback', 'readback']);
    });

    it('goes to readback when the policy no longer trusts the GPU', async () => {
      const {libmpv, sender} = await startedOn('d3d11-shared', () => 'readback');
      libmpv.redraw = vi.fn().mockReturnValue(true);
      await sender.checkAfterResume(20);
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['d3d11-shared', 'readback']);
    });

    it('stays on readback after repeated replacements within a minute', async () => {
      const {libmpv, sender} = await startedOn('d3d11-shared');
      libmpv.redraw = vi.fn().mockReturnValue(true);
      for (let i = 0; i < 4; i++) {
        await sender.checkAfterResume(10);
      }
      expect(libmpv.attaches.map(a => a.options.backend)).toEqual(['d3d11-shared', 'd3d11-shared', 'd3d11-shared', 'd3d11-shared', 'readback']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('staying on readback'));
    });

    it('does not replace the attach when the sender stopped meanwhile', async () => {
      const {libmpv, sender} = await startedOn('d3d11-shared');
      libmpv.redraw = vi.fn(() => {
        setImmediate(() => sender.stop());
        return true;
      });
      expect(await sender.checkAfterResume(500)).toBe('skipped');
      expect(libmpv.attaches).toHaveLength(1);
    });
  });

  describe('backendAfterGpuLoss', () => {
    const base ={configured: 'auto' as PreferredBackend, lossCount: 0, lossSinceOpen: 0, compositingEnabled: true};

    it('keeps the configured backend while the GPU process never died', () => {
      expect(backendAfterGpuLoss(base)).toBe('auto');
      expect(backendAfterGpuLoss({...base, configured: 'dmabuf-shared'})).toBe('dmabuf-shared');
    });

    it('uses readback for the rest of the project after the first loss', () => {
      expect(backendAfterGpuLoss({...base, lossCount: 1, lossSinceOpen: 1})).toBe('readback');
    });

    it('tries the shared backend again on the next project when GPU compositing is enabled', () => {
      expect(backendAfterGpuLoss({...base, lossCount: 1})).toBe('auto');
    });

    it('stays on readback on the next project when GPU compositing is disabled', () => {
      expect(backendAfterGpuLoss({...base, lossCount: 1, compositingEnabled: false})).toBe('readback');
    });

    it('uses readback until restart after a second loss', () => {
      expect(backendAfterGpuLoss({...base, lossCount: 2})).toBe('readback');
    });

    it('starts on readback without GPU compositing, unless a backend was chosen explicitly', () => {
      expect(backendAfterGpuLoss({...base, compositingEnabled: false, compositingDisabled: true})).toBe('readback');
      expect(backendAfterGpuLoss({...base, configured: 'd3d11-shared', compositingEnabled: false, compositingDisabled: true})).toBe('d3d11-shared');
      expect(backendAfterGpuLoss({...base, compositingEnabled: false})).toBe('auto');
    });

    it('does not turn an explicit readback into a shared backend', () => {
      expect(backendAfterGpuLoss({...base, configured: 'readback', lossCount: 1})).toBe('readback');
    });
  });
});
