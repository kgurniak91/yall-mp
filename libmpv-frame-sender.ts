// Electron side of the libmpv render path: takes the frames of a `Libmpv` renderer and delivers them to a
// renderer process, either as shared textures (GPU, zero copy) or as BGRA pixels over IPC (readback).
// The libmpv and Electron APIs are injected so the logic can be unit tested without either.
import type {
  AdapterOption,
  AttachRendererOptions,
  AttachResult,
  Libmpv,
  LibmpvEvent,
  RenderFrame,
  RenderBackendName,
  RenderStats,
  SharedBackendName,
  Size
} from './libmpv-bridge';
import {computeReadbackSize} from './libmpv-bridge';

/** Channel of the readback frames: `{attachId, width, height, data: Uint8Array}` (BGRA, alpha 255). */
export const READBACK_CHANNEL = 'libmpv:readback-frame';

export type PreferredBackend = SharedBackendName | 'readback' | 'auto';

export interface FrameSenderLibmpv extends Pick<Libmpv, 'sharedBackendName' | 'attachRenderer' | 'resize' | 'releaseSlot'
  | 'detachRenderer' | 'stats' | 'observeProperty' | 'unobserveProperty' | 'reinitVideo' | 'getProperty' | 'command'> {
  on(event: 'property-change' | 'end-file', listener: (event: LibmpvEvent) => void): unknown;
  off(event: 'property-change' | 'end-file', listener: (event: LibmpvEvent) => void): unknown;
}

export interface SharedTextureImportedLike {
  release(): void;
}

/** The part of `electron.sharedTexture` the sender uses. */
export interface SharedTextureApi {
  importSharedTexture(options: {
    textureInfo: { pixelFormat: 'bgra'; codedSize: Size; handle: { ntHandle: Buffer } | { ioSurface: Buffer } };
    allReferencesReleased?: () => void;
  }): SharedTextureImportedLike;

  sendSharedTexture(options: { frame: unknown; importedSharedTexture: SharedTextureImportedLike }): Promise<void>;
}

export interface FrameTarget {
  send(channel: string, ...args: unknown[]): void;
  mainFrame: unknown;
}

export interface GpuInfoLike {
  gpuDevice?: Array<{ vendorId?: number; deviceId?: number; active?: boolean }>;
}

export interface FrameSenderOptions {
  libmpv: FrameSenderLibmpv;
  webContents: FrameTarget;
  /** Result of `app.getGPUInfo('complete')`; the active device picks the adapter. */
  gpuInfo?: GpuInfoLike;
  log?: (message: string) => void;
  /** Defaults to `electron.sharedTexture`. */
  sharedTexture?: SharedTextureApi;
  /** Test and smoke hook: every shared-texture import throws. */
  simulateImportFailure?: boolean;
  /** Adapter override, e.g. 'warp' in CI. */
  adapter?: AdapterOption;
}

export interface StartOptions extends Size {
  preferred: PreferredBackend;
}

export interface FrameSenderStats {
  backend: string | null;
  attachId: number | null;
  sent: number;
  sendFailures: number;
  importFailures: number;
  staleDropped: number;
  fallbackReason: string | null;
  addon: RenderStats | null;
}

// How long after a fallback a failed video output is still blamed on the switch and repaired by reloading the file.
const RECOVERY_WINDOW_MS = 5000;

// Attach errors that mean "this machine cannot do the shared backend" rather than a broken player.
const FALLBACK_ATTACH_CODES = ['RENDER_INIT_FAILED', 'BACKEND_UNSUPPORTED'];

// "No receiver registered yet" is a timing problem of the page, not a broken GPU path.
const NO_RECEIVER = /receiver/i;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class LibmpvFrameSender {
  private readonly libmpv: FrameSenderLibmpv;
  private readonly target: FrameTarget;
  private readonly log: (message: string) => void;
  private readonly sharedTexture: () => SharedTextureApi;
  private readonly simulateImportFailure: boolean;
  private readonly adapterOverride?: AdapterOption;
  private readonly activeGpu?: { vendorId: number; deviceId: number };

  private attach: AttachResult | null = null;
  private canvas: Size = {width: 0, height: 0};
  private videoSize: Partial<Size> = {};
  private readbackSize: Size | null = null;
  private firstFrameDone = false;
  private switching = false;
  private observeIds: number[] = [];
  private recoveryListener: ((event: LibmpvEvent) => void) | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onPropertyChange = (event: LibmpvEvent): void => this.handlePropertyChange(event);

  private sent = 0;
  private sendFailures = 0;
  private importFailures = 0;
  private staleDropped = 0;
  private fallbackReason: string | null = null;
  private frameWaiters = new Set<{ afterSent: number; settle: (arrived: boolean) => void }>();

  constructor(options: FrameSenderOptions) {
    this.libmpv = options.libmpv;
    this.target = options.webContents;
    this.log = options.log ?? (() => undefined);
    this.simulateImportFailure = options.simulateImportFailure ?? false;
    this.adapterOverride = options.adapter;
    const injected = options.sharedTexture;
    this.sharedTexture = () => injected ?? (require('electron') as typeof import('electron')).sharedTexture as unknown as SharedTextureApi;
    const active = options.gpuInfo?.gpuDevice?.find(d => d.active);
    if (active?.vendorId !== undefined && active.deviceId !== undefined) {
      this.activeGpu = {vendorId: active.vendorId, deviceId: active.deviceId};
    }
  }

  start(options: StartOptions): AttachResult {
    this.stop();
    this.canvas = {width: options.width, height: options.height};
    this.fallbackReason = null;
    this.libmpv.on('property-change', this.onPropertyChange);
    for (const name of ['dwidth', 'dheight']) {
      this.observeIds.push(this.libmpv.observeProperty(name));
    }
    const shared = options.preferred === 'auto' ? this.libmpv.sharedBackendName() : options.preferred;
    if (!shared || shared === 'readback') {
      return this.attachBackend('readback');
    }
    try {
      return this.attachBackend(shared);
    } catch (error) {
      if (!FALLBACK_ATTACH_CODES.includes((error as { code?: string }).code ?? '')) {
        throw error;
      }
      // No frame was produced and no render context took the video output, so there is nothing to repair.
      this.fallbackReason = errorMessage(error);
      this.log(`[libmpv] ${shared} could not be attached (${errorMessage(error)}), using readback; platform=${process.platform}`);
      return this.attachBackend('readback');
    }
  }

  /** Canvas backing size (CSS px x devicePixelRatio). Debouncing is the caller's job. */
  setCanvasSize(width: number, height: number): void {
    this.canvas = {width, height};
    this.applySize();
  }

  /**
   * Resolves true once more than `afterSent` frames were sent (at once if that already holds), false after
   * `timeoutMs` or when the sender stops. Lets main tell the page that the picture after a seek is there.
   */
  waitForFrame(afterSent: number, timeoutMs: number): Promise<boolean> {
    if (this.sent > afterSent) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>(resolve => {
      const waiter = {
        afterSent,
        settle: (arrived: boolean): void => {
          clearTimeout(timer);
          this.frameWaiters.delete(waiter);
          resolve(arrived);
        }
      };
      const timer = setTimeout(() => waiter.settle(false), timeoutMs);
      timer.unref?.();
      this.frameWaiters.add(waiter);
    });
  }

  private countSent(): void {
    this.sent++;
    for (const waiter of [...this.frameWaiters]) {
      if (this.sent > waiter.afterSent) {
        waiter.settle(true);
      }
    }
  }

  stop(): void {
    for (const waiter of [...this.frameWaiters]) {
      waiter.settle(false);
    }
    this.cancelRecovery();
    this.libmpv.off('property-change', this.onPropertyChange);
    for (const id of this.observeIds) {
      try {
        this.libmpv.unobserveProperty(id);
      } catch {
        // the core may already be destroyed
      }
    }
    this.observeIds = [];
    if (this.attach) {
      this.attach = null;
      try {
        this.libmpv.detachRenderer();
      } catch {
        // the core may already be destroyed
      }
    }
    this.videoSize = {};
    this.readbackSize = null;
  }

  stats(): FrameSenderStats {
    return {
      backend: this.attach?.backend ?? null,
      attachId: this.attach?.attachId ?? null,
      sent: this.sent,
      sendFailures: this.sendFailures,
      importFailures: this.importFailures,
      staleDropped: this.staleDropped,
      fallbackReason: this.fallbackReason,
      addon: this.libmpv.stats()
    };
  }

  private adapterOption(): AdapterOption {
    return this.adapterOverride ?? this.activeGpu ?? 'default';
  }

  private attachBackend(backend: RenderBackendName): AttachResult {
    this.firstFrameDone = false;
    const size = backend === 'readback' ? this.computeReadback(false) : this.canvas;
    const options: AttachRendererOptions = {backend, width: size.width, height: size.height, adapter: this.adapterOption()};
    const result = this.libmpv.attachRenderer(options, frame => this.onFrame(frame));
    this.attach = result;
    if (backend === 'readback') {
      this.readbackSize = size;
      // The software cap is only known once the adapter is: shrink the frame size if needed.
      this.applySize();
    }
    return result;
  }

  private computeReadback(softwareKnown: boolean): Size {
    const software = softwareKnown && (this.attach?.adapter.software === true || this.attach?.impl === 'sw');
    const video = this.videoSize.width && this.videoSize.height
      ? {width: this.videoSize.width, height: this.videoSize.height}
      : undefined;
    return computeReadbackSize({canvas: this.canvas, video, software});
  }

  private applySize(): void {
    if (!this.attach || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return;
    }
    if (this.attach.backend !== 'readback') {
      this.libmpv.resize(this.canvas.width, this.canvas.height);
      return;
    }
    const next = this.computeReadback(true);
    if (!this.readbackSize || next.width !== this.readbackSize.width || next.height !== this.readbackSize.height) {
      this.readbackSize = next;
      this.libmpv.resize(next.width, next.height);
    }
  }

  private handlePropertyChange(event: LibmpvEvent): void {
    if (event.event !== 'property-change' || (event.name !== 'dwidth' && event.name !== 'dheight')) {
      return;
    }
    const value = typeof event.data === 'number' && event.data > 0 ? event.data : undefined;
    if (event.name === 'dwidth') {
      this.videoSize.width = value;
    } else {
      this.videoSize.height = value;
    }
    this.applySize();
  }

  private release(frame: RenderFrame): void {
    if (frame.slotId < 0) {
      return;
    }
    try {
      this.libmpv.releaseSlot(frame.attachId, frame.slotId, frame.serial);
    } catch {
      // the core may already be destroyed
    }
  }

  private onFrame(frame: RenderFrame): void {
    // Frames of a previous attach (after a fallback, a stop or a restart) must not be imported: their
    // device is gone and the import fails with "Unable to duplicate handle".
    if (!this.attach || frame.attachId !== this.attach.attachId) {
      this.staleDropped++;
      this.release(frame);
      return;
    }
    if (frame.pixels) {
      try {
        this.target.send(READBACK_CHANNEL, {
          attachId: frame.attachId, width: frame.width, height: frame.height, data: frame.pixels
        });
        this.countSent();
      } catch {
        // the page is gone (window closing): nothing to deliver to
        this.sendFailures++;
      }
      return;
    }
    this.sendShared(frame, this.attach);
  }

  private sendShared(frame: RenderFrame, attach: AttachResult): void {
    const isFirst = !this.firstFrameDone;
    this.firstFrameDone = true;
    let imported: SharedTextureImportedLike;
    try {
      if (this.simulateImportFailure) {
        throw new Error('simulated shared-texture import failure');
      }
      imported = this.sharedTexture().importSharedTexture({
        textureInfo: {
          pixelFormat: 'bgra', codedSize: {width: frame.width, height: frame.height},
          handle: attach.backend === 'iosurface-shared' ? {ioSurface: frame.handle!} : {ntHandle: frame.handle!}
        },
        allReferencesReleased: () => this.release(frame)
      });
    } catch (error) {
      this.importFailures++;
      this.release(frame);
      if (isFirst) {
        this.fallBackToReadback(attach, errorMessage(error));
      }
      return;
    }
    this.countSent();
    const onSendError = (error: unknown): void => {
      this.sendFailures++;
      imported.release();
      this.release(frame);
      if (isFirst && !NO_RECEIVER.test(errorMessage(error))) {
        this.fallBackToReadback(attach, errorMessage(error));
      }
    };
    try {
      // `mainFrame` throws once the page is destroyed; a send that throws synchronously is a failed send.
      this.sharedTexture().sendSharedTexture({frame: this.target.mainFrame, importedSharedTexture: imported})
        .then(() => imported.release())
        .catch(onSendError);
    } catch (error) {
      onSendError(error);
    }
  }

  private fallBackToReadback(failed: AttachResult, message: string): void {
    // Only the attach that failed may trigger the switch (a late rejection of an older one must not).
    if (this.switching || this.attach?.attachId !== failed.attachId) {
      return;
    }
    this.switching = true;
    try {
      this.fallbackReason = message;
      const a = failed.adapter;
      this.log(`[libmpv] shared-texture import failed on first frame (${message}), switching to readback; ` +
        `backend=${failed.backend} platform=${process.platform} adapter=${a.name} vendor/device=${a.vendorId}/${a.deviceId}`);
      // Asked before the first context is freed: on a slow machine the video output gives up (VO_INIT_FAILED)
      // while the second context is still being created, and then the file has to be loaded again.
      const snapshot = Promise.all(['path', 'time-pos', 'pause'].map(name => this.libmpv.getProperty(name).catch(() => undefined)));
      this.armRecovery(snapshot);
      this.attachBackend('readback');
      // The first render context took the video output with it when it was freed.
      this.libmpv.reinitVideo().catch((error: unknown) => this.log(`[libmpv] could not re-create the video output: ${errorMessage(error)}`));
    } finally {
      this.switching = false;
    }
  }

  private armRecovery(snapshot: Promise<unknown[]>): void {
    this.cancelRecovery();
    this.recoveryListener = (event: LibmpvEvent): void => {
      if (event.event !== 'end-file' || event.reason !== 'error' || event.error?.code !== 'VO_INIT_FAILED') {
        return;
      }
      this.cancelRecovery();
      this.reloadFile(snapshot).catch((error: unknown) => this.log(`[libmpv] could not reload the file after the switch: ${errorMessage(error)}`));
    };
    this.libmpv.on('end-file', this.recoveryListener);
    this.recoveryTimer = setTimeout(() => this.cancelRecovery(), RECOVERY_WINDOW_MS);
    this.recoveryTimer.unref?.();
  }

  private cancelRecovery(): void {
    if (this.recoveryListener) {
      this.libmpv.off('end-file', this.recoveryListener);
      this.recoveryListener = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private async reloadFile(snapshot: Promise<unknown[]>): Promise<void> {
    const [path, position, paused] = await snapshot;
    if (typeof path !== 'string' || !path) {
      return;
    }
    const start = typeof position === 'number' && position > 0 ? position : 0;
    this.log(`[libmpv] video output failed during the switch to readback, reloading the file at ${start.toFixed(2)} s`);
    await this.libmpv.command(['loadfile', path, 'replace', '-1', `start=${start},pause=${paused === false ? 'no' : 'yes'}`]);
  }
}
