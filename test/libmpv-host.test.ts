import {EventEmitter} from 'events';
import {Duplex, PassThrough} from 'stream';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  createHostAddon,
  encodeMessage,
  HostMessage,
  hostCandidates,
  MessageParser,
  MessageType
} from '../libmpv-host';
import type {LibmpvEvent, NativeMpvCore, RenderFrame} from '../libmpv-bridge';

const collect = (chunks: Buffer[]): HostMessage[] => {
  const out: HostMessage[] = [];
  const parser = new MessageParser(m => out.push(m));
  chunks.forEach(c => parser.push(c));
  return out;
};

describe('MessageParser', () => {
  const frame = encodeMessage(MessageType.frame, {attachId: 1, width: 2, height: 1}, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const reply = encodeMessage(MessageType.reply, {id: 7, value: {a: [1, 2]}});

  it('parses a message delivered in one chunk', () => {
    const [message] = collect([frame]);
    expect(message.type).toBe(MessageType.frame);
    expect(message.json).toEqual({attachId: 1, width: 2, height: 1});
    expect([...message.bin]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('parses messages split at every byte', () => {
    const all = Buffer.concat([reply, frame, reply]);
    const chunks = Array.from(all, (_, i) => all.subarray(i, i + 1));
    const messages = collect(chunks);
    expect(messages.map(m => m.type)).toEqual([MessageType.reply, MessageType.frame, MessageType.reply]);
    expect(messages[0].json).toEqual({id: 7, value: {a: [1, 2]}});
    expect(messages[1].bin.length).toBe(8);
    expect(messages[2].bin.length).toBe(0);
  });

  it('parses several messages from one chunk and a binary part that arrives late', () => {
    const joined = Buffer.concat([reply, reply]);
    expect(collect([joined])).toHaveLength(2);
    const cut = frame.length - 3;
    const messages = collect([frame.subarray(0, cut), frame.subarray(cut)]);
    expect(messages).toHaveLength(1);
    expect([...messages[0].bin]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps the unicode of the json part intact across chunks', () => {
    const message = encodeMessage(MessageType.event, {event: 'property-change', name: 'media-title', data: 'ünï ✓ 日本語'});
    const messages = collect([message.subarray(0, 20), message.subarray(20, 33), message.subarray(33)]);
    expect(messages[0].json.data).toBe('ünï ✓ 日本語');
  });

  it('rejects absurd lengths', () => {
    const bad = Buffer.alloc(12);
    bad.writeUInt32LE(MessageType.frame, 0);
    bad.writeUInt32LE(2, 4);
    bad.writeUInt32LE(0xffffffff, 8);
    expect(() => collect([bad])).toThrow(/malformed/);
  });
});

describe('hostCandidates', () => {
  it('prefers the environment, then the explicit path, the packaged resources and the build output', () => {
    const list = hostCandidates({
      env: {YALL_MPV_HOST: '/env/host'}, explicitPath: '/explicit', appRoot: '/app', resourcesPath: '/res', arch: 'x64'
    });
    expect(list[0]).toBe('/env/host');
    expect(list[1]).toBe('/explicit');
    expect(list[2]).toMatch(/res[\\/]yall-mpv-host$/);
    expect(list[3]).toMatch(/build[\\/]Release[\\/]yall-mpv-host$/);
    expect(list[4]).toMatch(/linux-x64[\\/]yall-mpv-host$/);
  });
});

// ---- a scripted host ----

/** The socket the client sees; `fromClient` is what the host reads. */
class FakeSocket extends Duplex {
  readonly fromClient: HostMessage[] = [];
  private readonly parser = new MessageParser(m => this.fromClient.push(m));

  override _read(): void {
  }

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.parser.push(chunk);
    callback();
    this.emit('client-wrote');
  }

  /** Host -> client. */
  send(type: number, json: unknown, bin?: Buffer): void {
    this.push(encodeMessage(type, json, bin));
  }
}

class FakeChild extends EventEmitter {
  readonly socket = new FakeSocket();
  readonly stderr = new PassThrough();
  readonly stdio = [null, null, this.stderr, this.socket];
  readonly kill = vi.fn((signal?: string) => {
    this.exit(null, signal ?? 'SIGTERM');
    return true;
  });

  exit(code: number | null, signal: string | null = null): void {
    this.emit('exit', code, signal);
  }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('host client', () => {
  let child: FakeChild;
  let core: NativeMpvCore;
  let events: LibmpvEvent[];
  const spawnSync = vi.fn();

  const makeAddon = () => createHostAddon({
    hostPath: '/host',
    spawn: vi.fn(() => child) as never,
    spawnSync: spawnSync as never
  });

  const lastSent = (type: number): HostMessage => {
    const found = [...child.socket.fromClient].reverse().find(m => m.type === type);
    if (!found) {
      throw new Error(`the host received no message of type ${type}`);
    }
    return found;
  };

  /** Creates a core and answers its create request. */
  const createCore = async (options: Record<string, string> = {}): Promise<void> => {
    const addon = makeAddon();
    spawnSync.mockReturnValue({status: 0, stdout: JSON.stringify({path: 'libmpv.so.2', apiVersion: [2, 5]}), stderr: ''});
    addon.loadLibrary('libmpv.so.2');
    core = new addon.MpvCore();
    events = [];
    core.onEvent(e => events.push(e));
    for (const [k, v] of Object.entries(options)) {
      core.setOption(k, v);
    }
    const init = core.initialize();
    await tick();
    const create = lastSent(MessageType.create);
    child.socket.send(MessageType.reply, {id: create.json.id, value: {path: 'libmpv.so.2', apiVersion: [2, 5]}});
    await init;
  };

  beforeEach(() => {
    child = new FakeChild();
  });

  afterEach(async () => {
    // A core that is still alive needs its host to exit, like a real one would after the destroy request.
    const done = core?.destroy();
    await tick();
    child.exit(0);
    await done;
  });

  it('sends the library path and the buffered options with the create request', async () => {
    await createCore({vo: 'libmpv', ao: 'null'});
    const create = lastSent(MessageType.create).json;
    expect(create.lib).toBe('libmpv.so.2');
    expect(create.options).toEqual([['vo', 'libmpv'], ['ao', 'null']]);
  });

  it('rejects initialize with the host error code', async () => {
    const addon = makeAddon();
    spawnSync.mockReturnValue({status: 0, stdout: JSON.stringify({path: 'x', apiVersion: [2, 5]}), stderr: ''});
    addon.loadLibrary('x');
    const failing = new addon.MpvCore();
    const init = failing.initialize();
    await tick();
    child.socket.send(MessageType.reply, {
      id: lastSent(MessageType.create).json.id,
      error: {code: 'OPTION_NOT_FOUND', message: 'option nope=1: option not found', mpvError: -5}
    });
    await expect(init).rejects.toMatchObject({code: 'OPTION_NOT_FOUND', mpvError: -5});
    core = failing;
  });

  it('routes replies by id, also when they arrive out of order', async () => {
    await createCore();
    const a = core.getProperty('volume');
    const b = core.command(['seek', '5', 'absolute']);
    const c = core.getProperty('nope');
    await tick();
    const [getVolume, command, getNope] = child.socket.fromClient.slice(-3);
    expect(getVolume.type).toBe(MessageType.getProperty);
    expect(command.json.args).toEqual(['seek', '5', 'absolute']);
    child.socket.send(MessageType.reply, {id: getNope.json.id, error: {code: 'PROPERTY_NOT_FOUND', message: 'not found', mpvError: -8}});
    child.socket.send(MessageType.reply, {id: command.json.id, value: null});
    child.socket.send(MessageType.reply, {id: getVolume.json.id, value: 100});
    expect(await a).toBe(100);
    expect(await b).toBeUndefined();
    await expect(c).rejects.toMatchObject({code: 'PROPERTY_NOT_FOUND', mpvError: -8});
  });

  it('sends property writes as typed json values and refuses other types', async () => {
    await createCore();
    const write = core.setProperty('speed', 1.5);
    await tick();
    const message = lastSent(MessageType.setProperty).json;
    expect(message).toMatchObject({name: 'speed', value: 1.5});
    child.socket.send(MessageType.reply, {id: message.id});
    await write;
    await expect(core.setProperty('x', {} as never)).rejects.toThrow(TypeError);
  });

  it('allocates observe ids on the client side', async () => {
    await createCore();
    const first = core.observeProperty('time-pos');
    const second = core.observeProperty('pause');
    expect(second).toBe(first + 1);
    await tick();
    expect(lastSent(MessageType.observe).json).toEqual({oid: second, name: 'pause'});
    core.unobserveProperty(first);
    core.requestLogMessages('warn');
    await tick();
    expect(lastSent(MessageType.unobserve).json).toEqual({oid: first});
    expect(lastSent(MessageType.logMessages).json).toEqual({level: 'warn'});
  });

  it('forwards host events to the listener', async () => {
    await createCore();
    child.socket.send(MessageType.event, {event: 'property-change', id: 1, name: 'time-pos', data: 1.25});
    child.socket.send(MessageType.event, {event: 'end-file', reason: 'error', error: {code: 'LOADING_FAILED', message: 'x'}});
    await tick();
    expect(events).toEqual([
      {event: 'property-change', id: 1, name: 'time-pos', data: 1.25},
      {event: 'end-file', reason: 'error', error: {code: 'LOADING_FAILED', message: 'x'}}
    ]);
  });

  describe('rendering', () => {
    const attach = (onFrame: (f: RenderFrame) => void) =>
      core.attachRenderer({backend: 'readback', width: 640, height: 360}, onFrame);

    it('answers an attach at once, confirms it with the host and delivers frames with an ack', async () => {
      await createCore();
      const frames: RenderFrame[] = [];
      const result = attach(f => frames.push(f));
      expect(result).toMatchObject({attachId: 1, backend: 'readback', impl: 'sw', gpuWaitImpl: 'none'});
      expect(result.adapter.software).toBe(true);
      await tick();
      const sent = lastSent(MessageType.attach).json;
      expect(sent).toMatchObject({attachId: 1, backend: 'readback', width: 640, height: 360});
      child.socket.send(MessageType.reply, {id: sent.id, value: {attachId: 1}});

      child.socket.send(MessageType.frame, {attachId: 1, slotId: -1, serial: 3, generation: 2, width: 2, height: 1},
        Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]));
      await tick();
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({attachId: 1, serial: 3, generation: 2, width: 2, height: 1});
      expect([...frames[0].pixels!]).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
      expect(lastSent(MessageType.frameAck).json).toEqual({count: 1});
    });

    it('acknowledges a frame even when the handler throws', async () => {
      await createCore();
      attach(() => {
        throw new Error('handler failed');
      });
      await tick();
      expect(() => child.socket.send(MessageType.frame, {attachId: 1, width: 1, height: 1}, Buffer.alloc(4))).not.toThrow();
      await tick();
      expect(child.socket.fromClient.some(m => m.type === MessageType.frameAck)).toBe(true);
    });

    it('reports a failed attach as a log message', async () => {
      await createCore();
      attach(() => undefined);
      await tick();
      child.socket.send(MessageType.reply, {id: lastSent(MessageType.attach).json.id, error: {code: 'RENDER_INIT_FAILED', message: 'no context'}});
      await tick();
      expect(events.find(e => e.event === 'log-message')).toMatchObject({level: 'error', text: expect.stringContaining('no context')});
    });

    it('refuses backends the host does not have', async () => {
      await createCore();
      expect(() => core.attachRenderer({backend: 'd3d11-shared', width: 1, height: 1}, () => undefined))
        .toThrowError(expect.objectContaining({code: 'BACKEND_UNSUPPORTED'}));
      expect(() => core.attachRenderer({backend: 'readback', impl: 'd3d11', width: 1, height: 1}, () => undefined))
        .toThrowError(expect.objectContaining({code: 'BACKEND_UNSUPPORTED'}));
    });

    it('forwards resize, release and detach, and keeps the last stats snapshot', async () => {
      await createCore();
      attach(() => undefined);
      core.resize(320, 180);
      core.releaseSlot(1, 2, 3);
      expect(core.stats()).toBeNull();
      await tick();
      expect(lastSent(MessageType.resize).json).toEqual({width: 320, height: 180});
      expect(lastSent(MessageType.releaseSlot).json).toEqual({attachId: 1, slotId: 2, serial: 3});
      child.socket.send(MessageType.reply, {id: lastSent(MessageType.stats).json.id, value: {attachId: 1, rendered: 5}});
      await tick();
      expect(core.stats()).toMatchObject({rendered: 5});
      core.detachRenderer();
      expect(core.stats()).toBeNull();
      await tick();
      expect(child.socket.fromClient.some(m => m.type === MessageType.detach)).toBe(true);
    });
  });

  describe('failure and shutdown', () => {
    it('rejects pending requests with HOST_CRASHED and reports a shutdown when the host dies', async () => {
      await createCore();
      child.stderr.write('mpv: segfault\n');
      await tick();
      const pending = core.getProperty('volume');
      child.exit(null, 'SIGSEGV');
      await expect(pending).rejects.toMatchObject({code: 'HOST_CRASHED', message: expect.stringContaining('SIGSEGV')});
      await expect(pending).rejects.toMatchObject({message: expect.stringContaining('mpv: segfault')});
      expect(events.map(e => e.event)).toEqual(['log-message', 'shutdown']);
      await expect(core.command(['stop'])).rejects.toMatchObject({code: 'HOST_CRASHED'});
    });

    it('reports a host that cannot be started', async () => {
      const addon = makeAddon();
      spawnSync.mockReturnValue({status: 0, stdout: JSON.stringify({path: 'x', apiVersion: [2, 5]}), stderr: ''});
      addon.loadLibrary('x');
      const broken = new addon.MpvCore();
      const events: LibmpvEvent[] = [];
      broken.onEvent(e => events.push(e));
      const init = broken.initialize();
      child.emit('error', new Error('spawn ENOENT'));
      await expect(init).rejects.toMatchObject({code: 'HOST_CRASHED', message: expect.stringContaining('ENOENT')});
      core = broken;
    });

    it('rejects waiting requests at once on destroy, then waits for the host to exit', async () => {
      await createCore();
      const pending = core.getProperty('volume');
      let destroyed = false;
      const done = core.destroy().then(() => destroyed = true);
      await expect(pending).rejects.toMatchObject({code: 'DESTROYED'});
      await tick();
      const destroy = lastSent(MessageType.destroy).json;
      expect(destroyed).toBe(false);
      child.socket.send(MessageType.reply, {id: destroy.id});
      await tick();
      expect(destroyed).toBe(false);
      child.exit(0);
      await done;
      expect(destroyed).toBe(true);
      await expect(core.getProperty('volume')).rejects.toMatchObject({code: 'DESTROYED'});
      await core.destroy();
    });

    it('counts live hosts', async () => {
      const addon = makeAddon();
      const before = addon.liveCounts().cores;
      await createCore();
      expect(addon.liveCounts().cores).toBe(before + 1);
      const done = core.destroy();
      await tick();
      child.exit(0);
      await done;
      expect(addon.liveCounts().cores).toBe(before);
    });

    it('kills a host that does not answer the destroy request', async () => {
      await createCore();
      vi.useFakeTimers();
      try {
        const done = core.destroy();
        await vi.advanceTimersByTimeAsync(9000);
        await done;
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('loadLibrary', () => {
    const load = (result: unknown) => {
      spawnSync.mockReturnValue(result);
      return makeAddon().loadLibrary('libmpv.so.2');
    };

    it('returns what the probe printed', () => {
      expect(load({status: 0, stdout: '{"path":"libmpv.so.2","apiVersion":[2,5]}\n', stderr: ''}))
        .toEqual({path: 'libmpv.so.2', apiVersion: [2, 5]});
      expect(spawnSync).toHaveBeenCalledWith('/host', ['--probe', 'libmpv.so.2'], expect.anything());
    });

    it('turns the probe error into an error with its code', () => {
      expect(() => load({status: 1, stdout: '{"code":"LIB_NOT_FOUND","error":"cannot open"}', stderr: ''}))
        .toThrowError(expect.objectContaining({code: 'LIB_NOT_FOUND', message: 'cannot open'}));
    });

    it('reports an unrunnable or garbled host', () => {
      expect(() => load({error: new Error('spawn EACCES'), status: null, stdout: '', stderr: ''}))
        .toThrowError(expect.objectContaining({code: 'LIB_NOT_FOUND', message: expect.stringContaining('EACCES')}));
      expect(() => load({status: 127, stdout: '', stderr: 'error while loading shared libraries'}))
        .toThrowError(expect.objectContaining({code: 'LIB_INVALID', message: expect.stringContaining('shared libraries')}));
    });

    it('refuses to create a core before a library is loaded', () => {
      const addon = makeAddon();
      expect(() => new addon.MpvCore()).toThrow(/loadLibrary/);
    });
  });
});
