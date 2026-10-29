// Client of yall-mpv-host, the out-of-process libmpv used on Linux. `createHostAddon` returns an object with
// the shape of the native addon, so `Libmpv`, `LibmpvManager` and the frame sender do not know the difference.
// It must not import `electron`, so it can be unit tested and run in plain Node.
//
// Differences from the in-process addon that callers can observe:
//  - `initialize()` and the first round trip are asynchronous (the host has to start);
//  - `attachRenderer` returns a promise for the host's own answer, so a backend that cannot work on this machine
//    rejects with the host's error code (the frame sender falls back to another backend on it);
//  - `stats()` returns the last snapshot received from the host (refreshed while a renderer is attached).
import {ChildProcess, spawn, spawnSync} from 'child_process';
import * as fs from 'fs';
import type {Socket} from 'net';
import * as path from 'path';
import type {
  AttachRendererOptions,
  AttachResult,
  LiveCounts,
  LibmpvEvent,
  LibmpvPropertyValue,
  NativeAddon,
  NativeMpvCore,
  DmabufPlane,
  RenderFrame,
  RenderStats
} from './libmpv-bridge';

// ---- wire format (native/yall-libmpv/host/protocol.h) ----

export const MessageType = {
  create: 1,
  command: 2,
  getProperty: 3,
  setProperty: 4,
  observe: 5,
  unobserve: 6,
  logMessages: 7,
  attach: 8,
  resize: 9,
  detach: 10,
  stats: 11,
  frameAck: 12,
  releaseSlot: 13,
  destroy: 14,
  redraw: 15,
  reply: 101,
  event: 102,
  frame: 103,
  slotClosed: 104
} as const;

const HEADER_BYTES = 12;
const MAX_JSON_BYTES = 16 << 20;
const MAX_BIN_BYTES = 64 << 20;

export interface HostMessage {
  type: number;
  json: any;
  bin: Buffer;
}

/** `[u32 type][u32 jsonLen][u32 binLen][json][bin]`, little endian. */
export const encodeMessage = (type: number, json: unknown, bin?: Buffer): Buffer => {
  const body = Buffer.from(JSON.stringify(json ?? {}), 'utf8');
  const binLength = bin?.length ?? 0;
  const out = Buffer.allocUnsafe(HEADER_BYTES + body.length + binLength);
  out.writeUInt32LE(type, 0);
  out.writeUInt32LE(body.length, 4);
  out.writeUInt32LE(binLength, 8);
  body.copy(out, HEADER_BYTES);
  bin?.copy(out, HEADER_BYTES + body.length);
  return out;
};

/**
 * Reassembles messages from arbitrary socket chunks. The binary part (a frame, megabytes) is read straight
 * into its own buffer, so no chunk list has to be concatenated per frame.
 */
export class MessageParser {
  private readonly header = Buffer.allocUnsafe(HEADER_BYTES);
  private headerFilled = 0;
  private type = 0;
  private json: Buffer | null = null;
  private jsonFilled = 0;
  private bin: Buffer | null = null;
  private binFilled = 0;
  private parsedJson: any = null;
  private jsonDone = false;

  constructor(private readonly onMessage: (message: HostMessage) => void) {
  }

  /** Throws on a malformed stream (the caller then treats the host as broken). */
  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.headerFilled < HEADER_BYTES) {
        const take = Math.min(HEADER_BYTES - this.headerFilled, chunk.length - offset);
        chunk.copy(this.header, this.headerFilled, offset, offset + take);
        this.headerFilled += take;
        offset += take;
        if (this.headerFilled === HEADER_BYTES) {
          this.startBody();
        }
        continue;
      }
      if (this.json && this.jsonFilled < this.json.length) {
        const take = Math.min(this.json.length - this.jsonFilled, chunk.length - offset);
        chunk.copy(this.json, this.jsonFilled, offset, offset + take);
        this.jsonFilled += take;
        offset += take;
        if (this.jsonFilled === this.json.length) {
          this.parsedJson = JSON.parse(this.json.toString('utf8'));
          this.jsonDone = true;
        }
      } else if (this.bin && this.binFilled < this.bin.length) {
        const take = Math.min(this.bin.length - this.binFilled, chunk.length - offset);
        chunk.copy(this.bin, this.binFilled, offset, offset + take);
        this.binFilled += take;
        offset += take;
      }
      this.finishIfComplete();
    }
  }

  private startBody(): void {
    const jsonLength = this.header.readUInt32LE(4);
    const binLength = this.header.readUInt32LE(8);
    if (jsonLength > MAX_JSON_BYTES || binLength > MAX_BIN_BYTES) {
      throw new Error(`malformed host message (json ${jsonLength} bytes, binary ${binLength} bytes)`);
    }
    this.type = this.header.readUInt32LE(0);
    this.json = Buffer.allocUnsafe(jsonLength);
    this.jsonFilled = 0;
    // Slow allocation outside the shared pool: frames are large and short lived.
    this.bin = binLength > 0 ? Buffer.allocUnsafeSlow(binLength) : Buffer.alloc(0);
    this.binFilled = 0;
    this.parsedJson = jsonLength === 0 ? {} : null;
    this.jsonDone = jsonLength === 0;
    this.finishIfComplete();
  }

  private finishIfComplete(): void {
    if (!this.json || !this.bin || !this.jsonDone || this.binFilled < this.bin.length) {
      return;
    }
    const message: HostMessage = {type: this.type, json: this.parsedJson, bin: this.bin};
    this.headerFilled = 0;
    this.json = null;
    this.bin = null;
    this.parsedJson = null;
    this.jsonDone = false;
    this.onMessage(message);
  }
}

// ---- descriptors of shared GPU buffers ----

/** The yall_fdpass addon (native/yall-libmpv/fdpass): receives the descriptors the host sends over its fd 4. */
export interface FdPassAddon {
  createFdChannel(): { parentFd: number; childFd: number };
  /** The callback runs on the main thread and owns the received descriptor (`fd` is -1 for a text-only message). */
  startReceiver(socketFd: number, onMessage: (fd: number, meta: string) => void): number;
  stopReceiver(receiverId: number): void;
  closeFd(fd: number): void;
  /** Test support. */
  sendFd(socketFd: number, fd: number, meta: string): void;
  readFd(fd: number, length?: number): Buffer;
}

/** One dma-buf plane of a shared slot, as the host reported it. The table owns `fd`. */
export interface SlotFd extends DmabufPlane {
  /** The size generation of the buffer (a resize replaces a slot's buffer). Absent in tests that do not care. */
  generation?: number;
}

const slotKey = (attachId: number, slotId: number): string => `${attachId}:${slotId}`;

interface FdWaiter {
  generation?: number;
  settle: (entry: SlotFd | null) => void;
}

/** How long a shared frame waits for a descriptor that is still on its way on the second socket. */
const FD_WAIT_MS = 250;

/**
 * The descriptors the host sent, by attach and slot. Slots are a fixed pool, so a descriptor arrives once and then
 * serves every frame of that slot. A frame can overtake its descriptor (two sockets), hence `wait`.
 */
export class FdTable {
  private readonly entries = new Map<string, SlotFd>();
  private readonly waiters = new Map<string, Set<FdWaiter>>();
  private closed = false;

  constructor(private readonly closeFd: (fd: number) => void) {
  }

  get size(): number {
    return this.entries.size;
  }

  add(attachId: number, slotId: number, entry: SlotFd): void {
    if (this.closed) {
      this.closeFd(entry.fd);
      return;
    }
    const key = slotKey(attachId, slotId);
    const previous = this.entries.get(key);
    if (previous) {
      this.closeFd(previous.fd);
    }
    this.entries.set(key, entry);
    const waiting = this.waiters.get(key);
    if (waiting) {
      for (const waiter of [...waiting]) {
        if (waiter.generation === undefined || waiter.generation === entry.generation) {
          waiter.settle(entry);
        }
      }
    }
  }

  get(attachId: number, slotId: number): SlotFd | undefined {
    return this.entries.get(slotKey(attachId, slotId));
  }

  /**
   * Resolves with the slot's descriptor, or null after `timeoutMs` (or when the table is closed). With `generation`
   * a descriptor of another generation (a buffer from before a resize) does not count.
   */
  wait(attachId: number, slotId: number, timeoutMs: number, generation?: number): Promise<SlotFd | null> {
    const key = slotKey(attachId, slotId);
    const existing = this.entries.get(key);
    if (existing && (generation === undefined || existing.generation === generation)) {
      return Promise.resolve(existing);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      const waiter: FdWaiter = {
        generation,
        settle: (entry: SlotFd | null): void => {
          clearTimeout(timer);
          this.waiters.get(key)?.delete(waiter);
          resolve(entry);
        }
      };
      const timer = setTimeout(() => waiter.settle(null), timeoutMs);
      timer.unref?.();
      const set = this.waiters.get(key) ?? new Set();
      set.add(waiter);
      this.waiters.set(key, set);
    });
  }

  remove(attachId: number, slotId: number): void {
    const key = slotKey(attachId, slotId);
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.closeFd(entry.fd);
    }
  }

  /** Closes every descriptor and refuses later ones (their sender is gone). */
  closeAll(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      this.closeFd(entry.fd);
    }
    this.entries.clear();
    for (const set of this.waiters.values()) {
      [...set].forEach(waiter => waiter.settle(null));
    }
    this.waiters.clear();
  }
}

// ---- host discovery ----

export interface HostCandidateOptions {
  env?: NodeJS.ProcessEnv;
  explicitPath?: string;
  /** The app root in dev (the directory of the compiled root files). */
  appRoot: string;
  /** `process.resourcesPath` in a packaged app, where electron-builder puts the host (extraResources). */
  resourcesPath?: string;
  arch?: string;
}

export const hostCandidates = (options: HostCandidateOptions): string[] => {
  const {env = process.env, explicitPath, appRoot, resourcesPath, arch = process.arch} = options;
  const addonDir = path.join(appRoot, 'native', 'yall-libmpv');
  const candidates = [
    env['YALL_MPV_HOST'],
    explicitPath,
    resourcesPath ? path.join(resourcesPath, 'yall-mpv-host') : undefined,
    path.join(addonDir, 'build', 'Release', 'yall-mpv-host'),
    path.join(addonDir, 'prebuilds', `linux-${arch}`, 'yall-mpv-host')
  ];
  return candidates.filter((c): c is string => !!c);
};

/** Where the yall_fdpass addon may be (Linux). */
export const fdpassCandidates = (options: HostCandidateOptions): string[] => {
  const {env = process.env, appRoot, arch = process.arch} = options;
  const addonDir = path.join(appRoot, 'native', 'yall-libmpv');
  return [
    env['YALL_FDPASS_ADDON'],
    path.join(addonDir, 'build', 'Release', 'yall_fdpass.node'),
    path.join(addonDir, 'prebuilds', `linux-${arch}`, 'yall_fdpass.node')
  ].filter((c): c is string => !!c);
};

// ---- the client ----

const START_TIMEOUT_MS = 15000;
const DESTROY_TIMEOUT_MS = 8000;
const STATS_REFRESH_MS = 250;
const STDERR_KEEP_BYTES = 2048;

const codedError = (code: string, message: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), {code}, extra);

const errorFromReply = (error: { code?: string; message?: string; mpvError?: number }): Error =>
  codedError(error.code ?? 'GENERIC', error.message ?? 'unknown error',
    error.mpvError !== undefined ? {mpvError: error.mpvError} : {});

let liveHosts = 0;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Dummy description of the adapter: the host only has mpv's software renderer. */
const SOFTWARE_ADAPTER = {
  name: 'mpv software renderer', vendorId: 0, deviceId: 0, luid: '0:0', software: true, matched: false, selection: 'sw'
};

class HostMpvCore implements NativeMpvCore {
  private readonly child: ChildProcess;
  private readonly socket: Socket;
  private readonly parser: MessageParser;
  private readonly options: Array<[string, string]> = [];
  private readonly pending = new Map<number, Pending>();
  private listener: ((event: LibmpvEvent) => void) | null = null;
  private frameHandlers = new Map<number, (frame: RenderFrame) => void>();
  private stderrTail = '';
  private nextRequestId = 1;
  private nextObserveId = 1;
  private nextAttachId = 1;
  private exited = false;
  private destroyed = false;
  private destroying: Promise<void> | null = null;
  private cachedStats: RenderStats | null = null;
  /** Bumped on attach and detach, so a stats answer that was already on its way is not taken for the new state. */
  private statsEpoch = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /** Frames that arrived before the answer to their attach; delivered after it so the caller knows the attach. */
  private readonly heldFrames = new Map<number, HostMessage[]>();
  private readonly fdTable: FdTable;
  /** Shared frames dropped because their descriptor never arrived. */
  sharedFrameFailures = 0;
  private fdChannel: { parentFd: number; receiverId: number } | null = null;

  constructor(hostPath: string, private readonly libraryPath: string, spawnHost: typeof spawn,
              private readonly fdpass: FdPassAddon | null) {
    liveHosts++;
    this.fdTable = new FdTable(fd => this.fdpass?.closeFd(fd));
    // Descriptors travel on a second socket (the host's fd 4): fd 3 belongs to Node, which would discard them.
    let channel: { parentFd: number; childFd: number } | null = null;
    try {
      channel = fdpass?.createFdChannel() ?? null;
    } catch {
      channel = null;
    }
    this.child = spawnHost(hostPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', ...(channel ? [channel.childFd] : [])]
    });
    if (channel && fdpass) {
      fdpass.closeFd(channel.childFd);
      try {
        const receiverId = fdpass.startReceiver(channel.parentFd, (fd, meta) => this.handleFd(fd, meta));
        this.fdChannel = {parentFd: channel.parentFd, receiverId};
      } catch {
        fdpass.closeFd(channel.parentFd);
      }
    }
    this.socket = this.child.stdio[3] as Socket;
    this.parser = new MessageParser(message => this.handleMessage(message));

    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-STDERR_KEEP_BYTES);
    });
    this.socket.on('data', (chunk: Buffer) => {
      try {
        this.parser.push(chunk);
      } catch (error) {
        this.handleExit(`sent a malformed message: ${(error as Error).message}`);
        this.child.kill('SIGKILL');
      }
    });
    // EPIPE and friends: the exit handler reports the real cause.
    this.socket.on('error', () => undefined);
    this.child.on('error', (error: Error) => this.handleExit(`could not be started: ${error.message}`));
    this.child.on('exit', (code, signal) =>
      this.handleExit(signal ? `was killed by ${signal}` : `exited with code ${code}`));
  }

  // ---- lifecycle ----

  setOption(name: string, value: string): void {
    this.options.push([name, value]);
  }

  async initialize(): Promise<void> {
    const timer = setTimeout(() => this.child.kill('SIGKILL'), START_TIMEOUT_MS);
    try {
      await this.request(MessageType.create, {lib: this.libraryPath, options: this.options});
    } finally {
      clearTimeout(timer);
    }
  }

  onEvent(listener: (event: LibmpvEvent) => void): void {
    this.listener = listener;
  }

  destroy(): Promise<void> {
    if (!this.destroying) {
      this.destroying = this.shutDown();
    }
    return this.destroying;
  }

  private async shutDown(): Promise<void> {
    this.destroyed = true;
    this.stopStatsTimer();
    // Like the addon: requests still waiting are rejected at once, whatever the host would have answered.
    this.rejectAll(codedError('DESTROYED', 'destroyed'));
    if (!this.exited) {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), DESTROY_TIMEOUT_MS);
      try {
        await this.request(MessageType.destroy, {}, true);
      } catch {
        // the host died or never answered: the exit handler below settles the rest
      }
      await new Promise<void>(resolve => {
        if (this.exited) {
          resolve();
          return;
        }
        this.child.once('exit', () => resolve());
      });
      clearTimeout(timer);
    }
    this.rejectAll(codedError('DESTROYED', 'destroyed'));
    this.socket.destroy();
    this.closeFdChannel();
    this.listener = null;
    this.frameHandlers.clear();
    this.heldFrames.clear();
  }

  private closeFdChannel(): void {
    const channel = this.fdChannel;
    this.fdChannel = null;
    // Closed first: descriptors still queued in the receiver are then closed by the table when they arrive.
    this.fdTable.closeAll();
    if (channel && this.fdpass) {
      this.fdpass.stopReceiver(channel.receiverId);
      this.fdpass.closeFd(channel.parentFd);
    }
  }

  /** A descriptor from the host: `meta` is {attachId, slotId, stride, offset, size, modifier}. */
  private handleFd(fd: number, meta: string): void {
    try {
      const info = JSON.parse(meta) as Partial<SlotFd> & { attachId?: number; slotId?: number };
      if (fd < 0 || typeof info.attachId !== 'number' || typeof info.slotId !== 'number') {
        throw new Error('incomplete descriptor message');
      }
      this.fdTable.add(info.attachId, info.slotId, {
        fd, stride: info.stride ?? 0, offset: info.offset ?? 0, size: info.size ?? 0, modifier: String(info.modifier ?? '0'),
        generation: info.generation
      });
    } catch {
      if (fd >= 0) {
        this.fdpass?.closeFd(fd);
      }
    }
  }

  /** The descriptors received so far, by attach and slot. */
  get slotFds(): FdTable {
    return this.fdTable;
  }

  /** True when the host was started with a descriptor channel, which the dma-buf backend needs. */
  get canPassFds(): boolean {
    return this.fdChannel !== null;
  }

  private handleExit(reason: string): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    liveHosts--;
    this.stopStatsTimer();
    this.closeFdChannel();
    if (this.destroyed) {
      this.rejectAll(codedError('DESTROYED', 'destroyed'));
      return;
    }
    const tail = this.stderrTail.trim();
    const message = `The libmpv host process ${reason}.${tail ? ` Last output: ${tail}` : ''}`;
    this.rejectAll(codedError('HOST_CRASHED', message));
    // Same signal the manager gets when mpv itself shuts down unexpectedly.
    this.emit({event: 'log-message', prefix: 'yall-host', level: 'fatal', text: message});
    this.emit({event: 'shutdown'});
  }

  // ---- requests ----

  private send(type: number, json: unknown): boolean {
    if (this.exited || !this.socket.writable) {
      return false;
    }
    this.socket.write(encodeMessage(type, json));
    return true;
  }

  private request(type: number, args: Record<string, unknown>, allowDestroyed = false): Promise<unknown> {
    if (this.destroyed && !allowDestroyed) {
      return Promise.reject(codedError('DESTROYED', 'destroyed'));
    }
    if (this.exited) {
      return Promise.reject(codedError('HOST_CRASHED', `The libmpv host process is not running.`));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      if (!this.send(type, {...args, id})) {
        this.pending.delete(id);
        reject(codedError('HOST_CRASHED', 'The libmpv host process is not running.'));
      }
    });
  }

  private rejectAll(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach(p => p.reject(error));
  }

  private emit(event: LibmpvEvent): void {
    this.listener?.(event);
  }

  command(args: string[]): Promise<unknown> {
    return this.request(MessageType.command, {args: args.map(String)});
  }

  getProperty(name: string): Promise<unknown> {
    return this.request(MessageType.getProperty, {name});
  }

  setProperty(name: string, value: LibmpvPropertyValue): Promise<void> {
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
      return Promise.reject(new TypeError('setProperty value must be a boolean, number or string'));
    }
    return this.request(MessageType.setProperty, {name, value}).then(() => undefined);
  }

  observeProperty(name: string): number {
    const oid = this.nextObserveId++;
    this.send(MessageType.observe, {oid, name});
    return oid;
  }

  unobserveProperty(oid: number): void {
    this.send(MessageType.unobserve, {oid});
  }

  requestLogMessages(level: string): void {
    this.send(MessageType.logMessages, {level});
  }

  // ---- rendering ----

  async attachRenderer(options: AttachRendererOptions, onFrame: (frame: RenderFrame) => void): Promise<AttachResult> {
    const dmabuf = options.backend === 'dmabuf-shared';
    if ((!dmabuf && options.backend !== 'readback') || options.impl === 'd3d11') {
      throw codedError('BACKEND_UNSUPPORTED', 'the Linux host provides the readback backend (software renderer) and dmabuf-shared');
    }
    if (dmabuf && !this.canPassFds) {
      throw codedError('BACKEND_UNSUPPORTED', 'the descriptor channel to the host is not available (yall_fdpass addon missing)');
    }
    if (this.destroyed) {
      throw codedError('DESTROYED', 'destroyed');
    }
    const attachId = this.nextAttachId++;
    this.statsEpoch++;
    this.frameHandlers.set(attachId, onFrame);
    this.heldFrames.set(attachId, []);
    // A handful of finished attaches may still deliver frames that were in flight.
    for (const staleId of [...this.frameHandlers.keys()].slice(0, -4)) {
      this.frameHandlers.delete(staleId);
    }
    let reply: Partial<AttachResult>;
    try {
      // The host picks the DRM node from Chromium's active GPU; it knows no D3D11 style adapter option.
      const {adapter, ...rest} = options;
      const gpu = typeof adapter === 'object' ? {vendorId: adapter.vendorId, deviceId: adapter.deviceId} : {};
      reply = (await this.request(MessageType.attach, {...rest, ...gpu, attachId})) as Partial<AttachResult>;
    } catch (error) {
      this.frameHandlers.delete(attachId);
      this.releaseHeldFrames(attachId, false);
      throw error;
    }
    this.startStatsTimer();
    // The caller learns the attach from this promise: frames that overtook the answer follow it.
    setImmediate(() => this.releaseHeldFrames(attachId, true));
    return {
      attachId, backend: reply.backend ?? options.backend, impl: reply.impl ?? 'sw', gpuWaitImpl: reply.gpuWaitImpl ?? 'none',
      adapter: reply.adapter ?? {...SOFTWARE_ADAPTER}
    };
  }

  private releaseHeldFrames(attachId: number, deliver: boolean): void {
    const held = this.heldFrames.get(attachId);
    this.heldFrames.delete(attachId);
    for (const message of held ?? []) {
      if (deliver) {
        this.deliverFrame(message);
      } else {
        this.send(MessageType.frameAck, {count: 1});
      }
    }
  }

  resize(width: number, height: number): void {
    this.send(MessageType.resize, {width, height});
  }

  redraw(): boolean {
    this.send(MessageType.redraw, {});
    return true;
  }

  releaseSlot(attachId: number, slotId: number, serial: number): void {
    this.send(MessageType.releaseSlot, {attachId, slotId, serial});
  }

  detachRenderer(): void {
    this.send(MessageType.detach, {});
    this.cachedStats = null;
    this.statsEpoch++;
    this.stopStatsTimer();
  }

  stats(): RenderStats | null {
    this.refreshStats();
    return this.cachedStats;
  }

  private refreshStats(): void {
    if (this.destroyed || this.exited) {
      return;
    }
    const epoch = this.statsEpoch;
    this.request(MessageType.stats, {})
      .then(value => {
        if (epoch === this.statsEpoch) {
          this.cachedStats = (value as RenderStats | null) ?? null;
        }
      })
      .catch(() => undefined);
  }

  private startStatsTimer(): void {
    if (!this.statsTimer) {
      this.statsTimer = setInterval(() => this.refreshStats(), STATS_REFRESH_MS);
      this.statsTimer.unref?.();
    }
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // ---- incoming ----

  private handleMessage(message: HostMessage): void {
    switch (message.type) {
      case MessageType.reply: {
        const pending = this.pending.get(message.json.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.json.id);
        if (message.json.error) {
          pending.reject(errorFromReply(message.json.error));
        } else {
          pending.resolve(message.json.value ?? undefined);
        }
        break;
      }
      case MessageType.event:
        this.emit(message.json as LibmpvEvent);
        break;
      case MessageType.frame: {
        const held = this.heldFrames.get(message.json.attachId);
        if (held) {
          held.push(message);
        } else {
          this.deliverFrame(message);
        }
        break;
      }
      case MessageType.slotClosed:
        this.fdTable.remove(message.json.attachId, message.json.slotId);
        break;
    }
  }

  private deliverFrame(message: HostMessage): void {
    const meta = message.json;
    if (meta.shared) {
      this.deliverSharedFrame(meta);
      return;
    }
    const handler = this.frameHandlers.get(meta.attachId);
    try {
      handler?.({
        attachId: meta.attachId, slotId: meta.slotId, serial: meta.serial, generation: meta.generation,
        width: meta.width, height: meta.height, pixels: message.bin
      });
    } catch (error) {
      // A broken consumer must not take the socket (or, from a timer, the process) down with it.
      this.emit({event: 'log-message', prefix: 'yall-host', level: 'error', text: `frame handler failed: ${(error as Error).message}`});
    } finally {
      // The frame is taken over, so the host may send the next one.
      this.send(MessageType.frameAck, {count: 1});
    }
  }

  /** A frame in a shared buffer: the descriptor arrived (or is about to) on the second socket. No pixel ack: the pool bounds the frames. */
  private deliverSharedFrame(meta: any): void {
    const handler = this.frameHandlers.get(meta.attachId);
    if (!handler) {
      return;
    }
    const deliver = (plane: SlotFd | null): void => {
      if (!plane) {
        // Without its descriptor the frame is useless: give the slot back instead of holding it until the timeout.
        this.sharedFrameFailures++;
        this.releaseSlot(meta.attachId, meta.slotId, meta.serial);
        this.emit({event: 'log-message', prefix: 'yall-host', level: 'error',
          text: `no descriptor for slot ${meta.slotId} (generation ${meta.generation}) within ${FD_WAIT_MS} ms`});
        return;
      }
      try {
        handler({
          attachId: meta.attachId, slotId: meta.slotId, serial: meta.serial, generation: meta.generation,
          width: meta.width, height: meta.height, probe: Array.isArray(meta.probe) ? meta.probe : undefined,
          dmabuf: {fd: plane.fd, stride: plane.stride, offset: plane.offset, size: plane.size, modifier: plane.modifier}
        });
      } catch (error) {
        this.emit({event: 'log-message', prefix: 'yall-host', level: 'error', text: `frame handler failed: ${(error as Error).message}`});
      }
    };
    const known = this.fdTable.get(meta.attachId, meta.slotId);
    if (known && known.generation === meta.generation) {
      deliver(known);
      return;
    }
    void this.fdTable.wait(meta.attachId, meta.slotId, FD_WAIT_MS, meta.generation).then(deliver);
  }
}

export interface HostAddonOptions {
  hostPath: string;
  /** The descriptor receiver; without it the host runs without the dma-buf backend. */
  fdpass?: FdPassAddon | null;
  /** Test seams. */
  spawn?: typeof spawn;
  spawnSync?: typeof spawnSync;
}

/** The addon-shaped facade over the host executable. Nothing is spawned until `loadLibrary` and `new MpvCore()`. */
export const createHostAddon = (options: HostAddonOptions): NativeAddon => {
  let loaded: { path: string; apiVersion: [number, number] } | null = null;

  class MpvCore extends HostMpvCore {
    constructor() {
      if (!loaded) {
        throw new Error('libmpv is not loaded, call loadLibrary() first');
      }
      super(options.hostPath, loaded.path, options.spawn ?? spawn, options.fdpass ?? null);
    }
  }

  return {
    kind: 'host',
    loadLibrary(libraryPath: string) {
      // Loaded in a throwaway process, so a missing or broken library never costs more than an error.
      const probe = (options.spawnSync ?? spawnSync)(options.hostPath, ['--probe', libraryPath], {encoding: 'utf8', timeout: 10000});
      if (probe.error) {
        throw codedError('LIB_NOT_FOUND', `The libmpv host could not be run: ${probe.error.message}`);
      }
      let result: { path?: string; apiVersion?: [number, number]; code?: string; error?: string };
      try {
        result = JSON.parse(probe.stdout);
      } catch {
        throw codedError('LIB_INVALID', `The libmpv host failed (${probe.status ?? probe.signal}): ${(probe.stderr || probe.stdout).trim()}`);
      }
      if (probe.status !== 0 || !result.path || !result.apiVersion) {
        throw codedError(result.code ?? 'LIB_NOT_FOUND', result.error ?? 'libmpv could not be loaded');
      }
      loaded = {path: result.path, apiVersion: result.apiVersion};
      return loaded;
    },
    apiVersion: () => loaded?.apiVersion ?? null,
    liveCounts: (): LiveCounts => ({cores: liveHosts, eventThreads: 0, renderers: 0, renderThreads: 0, slots: 0}),
    MpvCore: MpvCore as unknown as NativeAddon['MpvCore']
  };
};

export const hostExists = (hostPath: string): boolean => fs.existsSync(hostPath);
