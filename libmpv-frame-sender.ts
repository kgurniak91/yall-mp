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
import {needsToneMapFilter, TONE_MAP_VARIANTS, toneMapCommand} from './hdr-tonemap';

/** Channel of the readback frames: `{attachId, width, height, data: Uint8Array}` (BGRA, alpha 255). */
export const READBACK_CHANNEL = 'libmpv:readback-frame';
/** Main -> page: `{attachId, frames}`; the page then reports, for that many drawn frames, whether its probe points were black. */
export const PROBE_START_CHANNEL = 'libmpv:probe-start';
/** Page -> main: `black: boolean`. */
export const PROBE_REPORT_CHANNEL = 'libmpv:probe';

export type PreferredBackend = SharedBackendName | 'readback' | 'auto';

export interface GpuLossPolicyInput {
  /** What the platform and the environment would pick without any loss. */
  configured: PreferredBackend;
  /** Chromium GPU-process losses in this run. */
  lossCount: number;
  /** Losses since the current project was opened. */
  lossSinceOpen: number;
  /** `app.getGPUFeatureStatus().gpu_compositing` starts with "enabled". */
  compositingEnabled: boolean;
  /** `gpu_compositing` starts with "disabled" (software compositing): a shared texture cannot be imported then. */
  compositingDisabled?: boolean;
}

/**
 * Retry once: the first GPU-process loss costs the current project the shared backend (readback for the rest of
 * it); the next project tries it again if Chromium reports GPU compositing as enabled. A second loss in the same run
 * means readback until the app restarts.
 */
export function backendAfterGpuLoss(input: GpuLossPolicyInput): PreferredBackend {
  if (input.lossSinceOpen > 0 || input.lossCount >= 2 || (input.lossCount === 1 && !input.compositingEnabled)) {
    return 'readback';
  }
  // Without GPU compositing the first import fails ("GPU is not available") and the file is reloaded for the switch: start on readback instead.
  // An explicitly chosen backend is left alone (the fallback ladder is tested through it).
  if (input.configured === 'auto' && input.compositingDisabled) {
    return 'readback';
  }
  return input.configured;
}

export interface FrameSenderLibmpv extends Pick<Libmpv, 'sharedBackendName' | 'attachRenderer' | 'resize' | 'releaseSlot'
  | 'detachRenderer' | 'stats' | 'observeProperty' | 'unobserveProperty' | 'reinitVideo' | 'getProperty' | 'command'> {
  simulateDeviceLost?(attachId: number): boolean;
  redraw?(): boolean;
  on(event: 'property-change' | 'end-file', listener: (event: LibmpvEvent) => void): unknown;
  off(event: 'property-change' | 'end-file', listener: (event: LibmpvEvent) => void): unknown;
}

/** Electron's `nativePixmap` handle (Linux dma-buf). The modifier is a decimal string; Electron dups every plane fd. */
export interface NativePixmapHandle {
  planes: Array<{ fd: number; stride: number; offset: number; size: number }>;
  modifier: string;
  supportsZeroCopyWebGpuImport: boolean;
}

export type SharedTextureHandle = { ntHandle: Buffer } | { ioSurface: Buffer } | { nativePixmap: NativePixmapHandle };

export interface SharedTextureImportedLike {
  release(): void;
}

/** The part of `electron.sharedTexture` the sender uses. */
export interface SharedTextureApi {
  importSharedTexture(options: {
    textureInfo: { pixelFormat: 'bgra'; codedSize: Size; handle: SharedTextureHandle };
    allReferencesReleased?: () => void;
  }): SharedTextureImportedLike;

  sendSharedTexture(options: { frame: unknown; importedSharedTexture: SharedTextureImportedLike }, ...args: unknown[]): Promise<void>;
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
  /** Test and smoke hook: every shared frame in the validation window counts as imported black. */
  simulateBlackFrames?: boolean;
  /** Adapter override, e.g. 'warp' in CI. */
  adapter?: AdapterOption;
  /**
   * The backend to attach again after the GPU device behind a shared attach was lost (TDR). Main answers it from its
   * GPU-loss policy, so a healthy Chromium goes back to the shared backend and a dead one to readback. Default: `auto`.
   */
  preferredAfterDeviceLoss?: () => PreferredBackend;
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
  /** Black-frame check of the current shared attach: pending while it runs, then how it ended (null: no check ran). */
  validation: 'pending' | 'confirmed' | 'accepted' | 'black' | null;
  addon: RenderStats | null;
}

// How long after a fallback a failed video output is still blamed on the switch and repaired by reloading the file.
const RECOVERY_WINDOW_MS = 5000;

// Attach errors that mean "this machine cannot do the shared backend" rather than a broken player.
const FALLBACK_ATTACH_CODES = ['RENDER_INIT_FAILED', 'BACKEND_UNSUPPORTED'];

// A shared import can "succeed" and still show black. Until the page showed a picture, or this long, the first
// frames are checked against what the host rendered.
const VALIDATION_WINDOW_MS = 5000;
// Equal to kProbeFrames in native/yall-libmpv/src/render/backend.h.
const VALIDATION_FRAMES = 30;
const BLACK_STREAK_LIMIT = 3;

// A device that keeps getting lost is not worth another try: after this many re-attaches within the window the
// sender stays on readback.
const REATTACH_LIMIT = 3;
const REATTACH_WINDOW_MS = 60000;

// "No receiver registered yet" is a timing problem of the page, not a broken GPU path.
const NO_RECEIVER = /receiver/i;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class LibmpvFrameSender {
  private readonly libmpv: FrameSenderLibmpv;
  private readonly target: FrameTarget;
  private readonly log: (message: string) => void;
  private readonly sharedTexture: () => SharedTextureApi;
  private readonly simulateImportFailure: boolean;
  private readonly simulateBlackFrames: boolean;
  private readonly adapterOverride?: AdapterOption;
  private readonly preferredAfterDeviceLoss?: () => PreferredBackend;
  private reattachTimes: number[] = [];
  private readonly activeGpu?: { vendorId: number; deviceId: number };

  private attach: AttachResult | null = null;
  private canvas: Size = {width: 0, height: 0};
  private videoSize: Partial<Size> = {};
  private readbackSize: Size | null = null;
  /** `video-params/gamma` of the file on screen (`pq`, `hlg`, `bt.1886`, ...). */
  private gamma: string | null = null;
  /** The tone mapping filter of the software renderer: in the filter chain (`on`), not (`off`), or impossible here. */
  private toneMapFilter: 'off' | 'on' | 'unavailable' = 'off';
  /** The first filter variant not yet refused by this libmpv (a build without zscale refuses the first one). */
  private toneMapVariant = 0;
  private toneMapQueue: Promise<void> = Promise.resolve();
  private firstFrameDone = false;
  private switching = false;
  /** True from `stop()` until the next `start()`: an attach that finishes meanwhile is undone. */
  private stopped = true;
  private attachTicket = 0;
  private validation: { attachId: number; hostNonBlack: boolean; blackStreak: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private observeIds: number[] = [];
  private recoveryListener: ((event: LibmpvEvent) => void) | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onPropertyChange = (event: LibmpvEvent): void => this.handlePropertyChange(event);

  private sent = 0;
  private sendFailures = 0;
  private importFailures = 0;
  private staleDropped = 0;
  private fallbackReason: string | null = null;
  private validationVerdict: 'confirmed' | 'accepted' | 'black' | null = null;
  private frameWaiters = new Set<{ afterSent: number; settle: (arrived: boolean) => void }>();

  constructor(options: FrameSenderOptions) {
    this.libmpv = options.libmpv;
    this.target = options.webContents;
    this.log = options.log ?? (() => undefined);
    this.simulateImportFailure = options.simulateImportFailure ?? false;
    this.simulateBlackFrames = options.simulateBlackFrames ?? false;
    this.adapterOverride = options.adapter;
    this.preferredAfterDeviceLoss = options.preferredAfterDeviceLoss;
    const injected = options.sharedTexture;
    this.sharedTexture = () => injected ?? (require('electron') as typeof import('electron')).sharedTexture as unknown as SharedTextureApi;
    const active = options.gpuInfo?.gpuDevice?.find(d => d.active);
    if (active?.vendorId !== undefined && active.deviceId !== undefined) {
      this.activeGpu = {vendorId: active.vendorId, deviceId: active.deviceId};
    }
  }

  async start(options: StartOptions): Promise<AttachResult> {
    this.stop();
    this.stopped = false;
    this.canvas = {width: options.width, height: options.height};
    this.fallbackReason = null;
    this.reattachTimes = [];
    this.gamma = null;
    this.toneMapFilter = 'off';
    this.toneMapVariant = 0;
    this.libmpv.on('property-change', this.onPropertyChange);
    for (const name of ['dwidth', 'dheight', 'video-params/gamma']) {
      this.observeIds.push(this.libmpv.observeProperty(name));
    }
    const shared = options.preferred === 'auto' ? this.libmpv.sharedBackendName() : options.preferred;
    if (!shared || shared === 'readback') {
      return this.attachBackend('readback');
    }
    try {
      return await this.attachBackend(shared);
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
    this.stopped = true;
    for (const waiter of [...this.frameWaiters]) {
      waiter.settle(false);
    }
    this.cancelRecovery();
    this.endValidation();
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
      validation: this.validation ? 'pending' : this.validationVerdict,
      addon: this.libmpv.stats()
    };
  }

  private adapterOption(): AdapterOption {
    return this.adapterOverride ?? this.activeGpu ?? 'default';
  }

  private async attachBackend(backend: RenderBackendName): Promise<AttachResult> {
    this.firstFrameDone = false;
    const size = backend === 'readback' ? this.computeReadback(false) : this.canvas;
    const options: AttachRendererOptions = {backend, width: size.width, height: size.height, adapter: this.adapterOption()};
    const ticket = ++this.attachTicket;
    const result = await this.libmpv.attachRenderer(options, frame => this.onFrame(frame));
    if (ticket !== this.attachTicket || this.stopped) {
      // stop() or a newer attach came first. A newer attach replaces this one in the core by itself.
      if (this.stopped) {
        try {
          this.libmpv.detachRenderer();
        } catch {
          // the core may already be destroyed
        }
      }
      return result;
    }
    this.attach = result;
    if (backend !== 'readback') {
      this.logBackendNote(`${backend} attached`);
    }
    if (backend === 'readback') {
      this.readbackSize = size;
      // The software cap is only known once the adapter is: shrink the frame size if needed.
      this.applySize();
    }
    this.updateToneMapping();
    return result;
  }

  /** GL version/renderer and GL errors of a shared backend, for video.log (empty for backends without notes). */
  private logBackendNote(what: string): void {
    try {
      const stats = this.libmpv.stats();
      if (stats?.note) {
        this.log(`[libmpv] ${what}: glErrors=${stats.glErrors ?? 0} ${stats.note}`);
      }
    } catch {
      // diagnostics only
    }
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
    if (event.event === 'property-change' && event.name === 'video-params/gamma') {
      this.gamma = typeof event.data === 'string' ? event.data : null;
      this.updateToneMapping();
      return;
    }
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

  /**
   * HDR sources on the software renderer need the tone mapping filter (the GPU renderers do it themselves); it is added
   * when the picture is HDR and the current attach is `sw`, and taken out again for anything else. Runs when the
   * source changes and when the attach does.
   */
  private updateToneMapping(): void {
    const wanted = needsToneMapFilter(this.attach?.impl, this.gamma);
    if (this.toneMapFilter === 'unavailable' || wanted === (this.toneMapFilter === 'on')) {
      return;
    }
    this.toneMapFilter = wanted ? 'on' : 'off';
    // One command at a time: a source change right after another must not overtake the first command
    this.toneMapQueue = this.toneMapQueue.then(() => wanted ? this.addToneMapFilter() : this.removeToneMapFilter());
  }

  private async addToneMapFilter(): Promise<void> {
    let refusedAll = true;
    for (let i = this.toneMapVariant; i < TONE_MAP_VARIANTS.length; i++) {
      const variant = TONE_MAP_VARIANTS[i];
      if (!(variant.gammas as readonly string[]).includes(this.gamma ?? '')) {
        // this variant cannot do this kind of source (the lookup table graph does PQ only)
        refusedAll = false;
        continue;
      }
      try {
        await this.libmpv.command(toneMapCommand(true, variant));
        this.toneMapVariant = i;
        this.log(`[libmpv] HDR tone mapping filter added (${variant.name}; gamma=${this.gamma}, impl=${this.attach?.impl})`);
        return;
      } catch (error) {
        // mpv's ffmpeg has no zscale (the macOS build): the next variant needs only common filters
        this.toneMapVariant = i + 1;
        this.log(`[libmpv] HDR tone mapping filter '${variant.name}' was refused (${errorMessage(error)})`);
      }
    }
    this.toneMapFilter = refusedAll ? 'unavailable' : 'off';
    if (refusedAll) {
      this.log('[libmpv] HDR tone mapping is not available in this libmpv; the picture stays untouched');
    }
  }

  private async removeToneMapFilter(): Promise<void> {
    try {
      await this.libmpv.command(toneMapCommand(false));
      this.log(`[libmpv] HDR tone mapping filter removed (gamma=${this.gamma}, impl=${this.attach?.impl})`);
    } catch {
      // it was never in the chain
    }
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
    if (frame.lost !== undefined) {
      void this.reattachAfterDeviceLoss(this.attach, frame.lost);
      return;
    }
    if (frame.pixels) {
      try {
        this.target.send(READBACK_CHANNEL, {
          attachId: frame.attachId, width: frame.width, height: frame.height, data: frame.pixels, renderedAt: frame.renderedAt
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
    if (isFirst) {
      this.beginValidation(attach);
    }
    this.noteHostProbe(frame);
    try {
      if (this.simulateImportFailure) {
        throw new Error('simulated shared-texture import failure');
      }
      imported = this.sharedTexture().importSharedTexture({
        textureInfo: {
          pixelFormat: 'bgra', codedSize: {width: frame.width, height: frame.height},
          handle: this.textureHandle(frame, attach)
        },
        allReferencesReleased: () => this.release(frame)
      });
    } catch (error) {
      this.importFailures++;
      this.release(frame);
      if (isFirst) {
        void this.fallBackToReadback(attach, errorMessage(error));
      }
      return;
    }
    this.countSent();
    if (this.simulateBlackFrames && this.validation) {
      this.validation.hostNonBlack = true;
      this.handlePageProbe(true);
    }
    if (isFirst) {
      this.logBackendNote(`first ${attach.backend} frame ${frame.width}x${frame.height} sent`);
    }
    const onSendError = (error: unknown): void => {
      this.sendFailures++;
      imported.release();
      this.release(frame);
      if (isFirst && !NO_RECEIVER.test(errorMessage(error))) {
        void this.fallBackToReadback(attach, errorMessage(error));
      }
    };
    try {
      // `mainFrame` throws once the page is destroyed; a send that throws synchronously is a failed send.
      // The extra argument reaches the page's receiver next to the texture
      this.sharedTexture().sendSharedTexture({frame: this.target.mainFrame, importedSharedTexture: imported}, {renderedAt: frame.renderedAt})
        .then(() => imported.release())
        .catch(onSendError);
    } catch (error) {
      onSendError(error);
    }
  }

  private textureHandle(frame: RenderFrame, attach: AttachResult): SharedTextureHandle {
    if (frame.dmabuf) {
      const {fd, stride, offset, size, modifier} = frame.dmabuf;
      // We draw with WebGL2, not WebGPU, so the zero-copy WebGPU import is not needed.
      return {nativePixmap: {planes: [{fd, stride, offset, size}], modifier, supportsZeroCopyWebGpuImport: false}};
    }
    return attach.backend === 'iosurface-shared' ? {ioSurface: frame.handle!} : {ntHandle: frame.handle!};
  }

  /** The page's verdict on one drawn frame of the validation window: were all its probe points black? */
  reportPageProbe(black: boolean): void {
    this.handlePageProbe(black);
  }

  /** Chromium's GPU process died: the shared textures are gone with it, so the rest of the session uses readback. */
  gpuProcessGone(reason: string): void {
    const attach = this.attach;
    if (attach && attach.backend !== 'readback') {
      void this.fallBackToReadback(attach, `GPU process gone (${reason})`, 'the GPU process is gone');
    }
  }

  /** Test support: makes the current attach report its device as lost. False when nothing can be simulated. */
  simulateDeviceLost(): boolean {
    return this.attach ? this.libmpv.simulateDeviceLost?.(this.attach.attachId) ?? false : false;
  }

  /** The GPU device behind a shared attach was removed (TDR): attach again on a new device, or readback. */
  private async reattachAfterDeviceLoss(lost: AttachResult, reason: string): Promise<void> {
    if (lost.backend === 'readback' || this.attach?.attachId !== lost.attachId) {
      return;
    }
    await this.reattach(lost, `GPU device lost (${reason})`, 'the GPU device was lost', this.preferredAfterDeviceLoss?.() ?? 'auto');
  }

  /**
   * After the machine woke from sleep (or any pause in the app's life): ask for the picture on screen again and expect
   * a frame within `timeoutMs`. A GPU device or swap chain that did not survive shows as no frame at all; then the
   * current attach is replaced. `skipped`: nothing to check (no attach, no video, a switch already running).
   */
  async checkAfterResume(timeoutMs = 2000): Promise<'ok' | 'reattached' | 'skipped'> {
    const attach = this.attach;
    if (!attach || this.stopped || this.switching || !this.videoSize.width || !this.videoSize.height) {
      return 'skipped';
    }
    const baseline = this.sent;
    if (!this.libmpv.redraw?.()) {
      return 'skipped';
    }
    if (await this.waitForFrame(baseline, timeoutMs)) {
      return 'ok';
    }
    if (this.stopped || this.attach?.attachId !== attach.attachId) {
      return 'skipped';
    }
    // A readback attach that stopped answering is rebuilt as readback: its fallback reason still holds.
    const target: PreferredBackend = attach.backend === 'readback' ? 'readback' : this.preferredAfterDeviceLoss?.() ?? 'auto';
    await this.reattach(attach, 'no frames after resume', 'no frame arrived after the machine resumed', target);
    return 'reattached';
  }

  /** Replaces the attach, at most `REATTACH_LIMIT` times per `REATTACH_WINDOW_MS`; after that it stays on readback. */
  private async reattach(lost: AttachResult, message: string, what: string, preferred: PreferredBackend): Promise<void> {
    const now = Date.now();
    this.reattachTimes = this.reattachTimes.filter(t => now - t < REATTACH_WINDOW_MS);
    let target = preferred;
    if (this.reattachTimes.length >= REATTACH_LIMIT) {
      this.log(`[libmpv] the video backend was replaced ${REATTACH_LIMIT} times within ${REATTACH_WINDOW_MS / 1000} s, staying on readback`);
      target = 'readback';
    } else {
      this.reattachTimes.push(now);
    }
    await this.switchBackend(lost, message, what, target);
  }

  private beginValidation(attach: AttachResult): void {
    this.endValidation();
    this.validationVerdict = null;
    const timer = setTimeout(() => {
      if (this.validation?.attachId === attach.attachId) {
        this.log(`[libmpv] ${attach.backend}: first frames not confirmed within ${VALIDATION_WINDOW_MS} ms, accepting`);
        this.validationVerdict = 'accepted';
        this.endValidation();
      }
    }, VALIDATION_WINDOW_MS);
    timer.unref?.();
    this.validation = {attachId: attach.attachId, hostNonBlack: false, blackStreak: 0, timer};
    try {
      this.target.send(PROBE_START_CHANNEL, {attachId: attach.attachId, frames: VALIDATION_FRAMES});
    } catch {
      // the page is gone: nothing to validate against
    }
  }

  private endValidation(): void {
    if (this.validation) {
      clearTimeout(this.validation.timer);
      this.validation = null;
    }
  }

  private noteHostProbe(frame: RenderFrame): void {
    const v = this.validation;
    if (!v || !frame.probe) {
      return;
    }
    for (let i = 0; i + 2 < frame.probe.length; i += 4) {
      // BGRA: any non-zero colour channel means the host rendered a picture
      if (frame.probe[i] || frame.probe[i + 1] || frame.probe[i + 2]) {
        v.hostNonBlack = true;
        return;
      }
    }
  }

  private handlePageProbe(black: boolean): void {
    const v = this.validation;
    const attach = this.attach;
    if (!v || !attach || attach.attachId !== v.attachId) {
      return;
    }
    if (!black) {
      this.log(`[libmpv] ${attach.backend}: first frames confirmed by the page`);
      this.validationVerdict = 'confirmed';
      this.endValidation();
      return;
    }
    if (!v.hostNonBlack) {
      // The video itself is black so far: nothing to compare with.
      v.blackStreak = 0;
      return;
    }
    if (++v.blackStreak >= BLACK_STREAK_LIMIT) {
      this.validationVerdict = 'black';
      this.endValidation();
      void this.fallBackToReadback(attach, `the page read black from ${attach.backend} frames the host rendered non-black`,
        'imported frames are black');
    }
  }

  private fallBackToReadback(failed: AttachResult, message: string, what = 'shared-texture import failed on first frame'): Promise<void> {
    return this.switchBackend(failed, message, what, 'readback');
  }

  private async switchBackend(failed: AttachResult, message: string, what: string, target: PreferredBackend): Promise<void> {
    // Only the attach that failed may trigger the switch (a late rejection of an older one must not).
    if (this.switching || this.attach?.attachId !== failed.attachId) {
      return;
    }
    this.switching = true;
    this.endValidation();
    try {
      const shared = target === 'auto' ? this.libmpv.sharedBackendName() : target;
      const next: RenderBackendName = shared && shared !== 'readback' ? shared : 'readback';
      this.fallbackReason = message;
      const a = failed.adapter;
      this.log(`[libmpv] ${what} (${message}), switching to ${next}; ` +
        `backend=${failed.backend} platform=${process.platform} adapter=${a.name} vendor/device=${a.vendorId}/${a.deviceId}`);
      // Asked before the first context is freed: on a slow machine the video output gives up (VO_INIT_FAILED)
      // while the second context is still being created, and then the file has to be loaded again.
      const snapshot = Promise.all(['path', 'time-pos', 'pause'].map(name => this.libmpv.getProperty(name).catch(() => undefined)));
      this.armRecovery(snapshot);
      // Frames of the failed attach that are still on their way are stale from here on.
      this.attach = null;
      try {
        await this.attachBackend(next);
      } catch (error) {
        if (next === 'readback' || !FALLBACK_ATTACH_CODES.includes((error as { code?: string }).code ?? '')) {
          throw error;
        }
        this.log(`[libmpv] ${next} could not be attached again (${errorMessage(error)}), using readback`);
        await this.attachBackend('readback');
      }
      // The first render context took the video output with it when it was freed.
      this.libmpv.reinitVideo().catch((error: unknown) => this.log(`[libmpv] could not re-create the video output: ${errorMessage(error)}`));
    } catch (error) {
      this.log(`[libmpv] the video backend could not be attached after the switch: ${errorMessage(error)}`);
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
