/** A size in pixels. */
export interface Dimensions {
  width: number;
  height: number;
}

export interface FitRect extends Dimensions {
  x: number;
  y: number;
}

/**
 * Largest rectangle with the aspect ratio of `frame` that fits `canvas`, centred. A frame is never stretched: after
 * a resize the frame in hand can still have the previous size until mpv has rendered a new one.
 */
export function computeFit(frame: Dimensions, canvas: Dimensions): FitRect {
  if (frame.width <= 0 || frame.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return {x: 0, y: 0, width: 0, height: 0};
  }
  const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  return {x: Math.round((canvas.width - width) / 2), y: Math.round((canvas.height - height) / 2), width, height};
}

export interface VideoSurfaceStats {
  backend: 'webgl2' | '2d' | 'none';
  received: number;
  drawn: number;
  dropped: number;
  /** Frames handed to `present` that were closed again; received - closed = frames still open. */
  closed: number;
  errors: number;
  contextLosses: number;
  canvasWidth: number;
  canvasHeight: number;
  lastFrameWidth: number;
  lastFrameHeight: number;
  /** Drawn frames that carried a render timestamp; the latency numbers cover the last `LATENCY_WINDOW` of them. */
  latencySamples: number;
  /**
   * Milliseconds from the render thread finishing a frame to the draw call on the canvas (queue into main, hand-over to
   * the page, wait for the animation frame). The compositor adds about one display refresh after that.
   */
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
}

export const LATENCY_WINDOW = 300;
/** How long a lost WebGL context gets to come back before the canvas counts as dead (Chromium restores within a few frames). */
export const CONTEXT_RESTORE_WAIT_MS = 1500;

export interface RendererHandOver {
  frame: VideoFrame | null;
  renderedAt: number | undefined;
  stats: VideoSurfaceStats;
}

/** Median, 95th percentile and maximum of the samples (0 for none). */
export function summarizeLatency(samples: readonly number[]): { p50: number; p95: number; max: number } {
  if (samples.length === 0) {
    return {p50: 0, p95: 0, max: 0};
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]};
}

const VERTEX_SHADER = `#version 300 es
uniform vec4 uRect; // left, bottom, right, top in clip space
out vec2 vUv;
void main() {
  vec2 a = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(mix(uRect.xy, uRect.zw, a), 0.0, 1.0);
  vUv = vec2(a.x, 1.0 - a.y);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uTexture, vUv).rgb, 1.0);
}`;

interface GlResources {
  program: WebGLProgram;
  texture: WebGLTexture;
  rect: WebGLUniformLocation;
}

/**
 * Draws the frames of the video surface on a canvas: WebGL2 where it is available (the cheapest way to get a
 * `VideoFrame` on screen), a 2d context otherwise. Latest frame wins, one animation frame per received frame and
 * none while nothing arrives. The frame that was drawn last stays open until the next one replaces it, so a resize
 * or a lost GL context can be redrawn while playback is paused.
 */
export class VideoSurfaceRenderer {
  public readonly stats: VideoSurfaceStats = {
    backend: 'none', received: 0, drawn: 0, dropped: 0, closed: 0, errors: 0, contextLosses: 0,
    canvasWidth: 0, canvasHeight: 0, lastFrameWidth: 0, lastFrameHeight: 0,
    latencySamples: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyMaxMs: 0
  };

  private readonly gl: WebGL2RenderingContext | null;
  private readonly ctx2d: CanvasRenderingContext2D | null = null;
  private resources: GlResources | null = null;
  private pending: VideoFrame | null = null;
  private pendingRenderedAt: number | undefined;
  private readonly latencies: number[] = [];
  private current: VideoFrame | null = null;
  private frameRequest = 0;
  private disposed = false;
  private contextLost = false;
  private textureHoldsCurrent = false;
  private probeFrames = 0;
  private probeReport: ((black: boolean) => void) | null = null;

  /** Called when a lost WebGL context did not come back by itself: the canvas stays dead, so the owner has to replace it. */
  public onUnrecoverable: (() => void) | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.resources = null;
    this.textureHoldsCurrent = false;
    this.stats.contextLosses++;
    clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => {
      if (this.contextLost && !this.disposed) {
        this.onUnrecoverable?.();
      }
    }, CONTEXT_RESTORE_WAIT_MS);
  };

  private readonly onContextRestored = (): void => {
    clearTimeout(this.restoreTimer);
    this.contextLost = false;
    this.createResources();
    this.redraw();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false});
    if (this.gl) {
      this.stats.backend = 'webgl2';
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      canvas.addEventListener('webglcontextrestored', this.onContextRestored);
      this.createResources();
    } else {
      this.ctx2d = canvas.getContext('2d', {alpha: false});
      this.stats.backend = this.ctx2d ? '2d' : 'none';
    }
    this.stats.canvasWidth = canvas.width;
    this.stats.canvasHeight = canvas.height;
    (window as unknown as { __yallVideoStats?: VideoSurfaceStats }).__yallVideoStats = this.stats;
  }

  /**
   * Takes ownership of `frame`: it is closed once it was replaced or drawn and replaced. `renderedAt` is when the render
   * thread finished it (ms since the Unix epoch), for the latency statistics.
   */
  public present(frame: VideoFrame, renderedAt?: number): void {
    this.stats.received++;
    if (this.disposed || this.stats.backend === 'none') {
      this.closeFrame(frame);
      return;
    }
    if (this.pending) {
      this.closeFrame(this.pending);
      this.stats.dropped++;
    }
    this.pending = frame;
    this.pendingRenderedAt = renderedAt;
    if (!this.frameRequest) {
      this.frameRequest = requestAnimationFrame(() => {
        this.frameRequest = 0;
        this.renderNow();
      });
    }
  }

  /** Draws the newest pending frame at once (the animation frame callback; also for tests). */
  public renderNow(): void {
    const frame = this.pending;
    if (!frame || this.disposed) {
      return;
    }
    this.pending = null;
    const renderedAt = this.pendingRenderedAt;
    this.pendingRenderedAt = undefined;
    this.closeFrame(this.current);
    this.current = frame;
    this.textureHoldsCurrent = false;
    this.stats.lastFrameWidth = frame.displayWidth;
    this.stats.lastFrameHeight = frame.displayHeight;
    this.draw();
    this.recordLatency(renderedAt);
    this.probeDrawnFrame();
  }

  private recordLatency(renderedAt: number | undefined): void {
    if (renderedAt === undefined || !Number.isFinite(renderedAt) || renderedAt <= 0) {
      return;
    }
    // Both ends read the system clock (the page through its time origin), so a negative value is clock noise
    this.latencies.push(Math.max(0, performance.timeOrigin + performance.now() - renderedAt));
    if (this.latencies.length > LATENCY_WINDOW) {
      this.latencies.shift();
    }
    this.stats.latencySamples++;
    if (this.stats.latencySamples % 8 === 0 || this.latencies.length < 8) {
      const summary = summarizeLatency(this.latencies);
      this.stats.latencyP50Ms = summary.p50;
      this.stats.latencyP95Ms = summary.p95;
      this.stats.latencyMaxMs = summary.max;
    }
  }

  /** Reports, for each of the next `frames` newly drawn frames, whether five points of the picture are black. */
  public startProbe(frames: number, report: (black: boolean) => void): void {
    this.probeFrames = frames;
    this.probeReport = report;
  }

  private probeDrawnFrame(): void {
    const report = this.probeReport;
    const frame = this.current;
    if (!report || this.probeFrames <= 0 || !frame || (this.gl ? this.contextLost : !this.ctx2d)) {
      return;
    }
    if (--this.probeFrames === 0) {
      this.probeReport = null;
    }
    try {
      const fit = this.fit(frame);
      const xs = [0.5, 0.25, 0.75, 0.25, 0.75];
      const ys = [0.5, 0.25, 0.25, 0.75, 0.75];
      const black = xs.every((fx, i) => {
        const x = Math.min(this.canvas.width - 1, Math.round(fit.x + fit.width * fx));
        const y = Math.min(this.canvas.height - 1, Math.round(fit.y + fit.height * ys[i]));
        const [r, g, b] = this.readPixel(x, y);
        return r === 0 && g === 0 && b === 0;
      });
      report(black);
    } catch {
      // a failed probe is no evidence either way
    }
  }

  /**
   * Resizes the backing store and redraws the kept frame in the same task, so the canvas is never shown cleared.
   * Call it once the size has settled: assigning `width`/`height` clears the canvas.
   */
  public setBackingSize(width: number, height: number): void {
    if (this.disposed || width < 1 || height < 1 || (width === this.canvas.width && height === this.canvas.height)) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.stats.canvasWidth = width;
    this.stats.canvasHeight = height;
    this.redraw();
  }

  /**
   * Gives up the newest frame (still open) and the counters, for the renderer of a replacement canvas. This renderer is
   * disposed afterwards, so it neither closes the frame nor keeps drawing.
   */
  public handOver(): RendererHandOver {
    const frame = this.pending ?? this.current;
    const renderedAt = this.pending ? this.pendingRenderedAt : undefined;
    if (this.pending && this.current) {
      this.closeFrame(this.current);
    }
    this.pending = this.current = null;
    const stats = {...this.stats};
    this.dispose();
    return {frame, renderedAt, stats};
  }

  /** Continues where the renderer that was handed over stopped: its counters and its newest frame. */
  public adopt(handOver: RendererHandOver): void {
    const {canvasWidth, canvasHeight} = this.stats;
    Object.assign(this.stats, handOver.stats, {backend: this.stats.backend, canvasWidth, canvasHeight});
    if (handOver.frame) {
      this.stats.received--;
      this.present(handOver.frame, handOver.renderedAt);
    }
  }

  /** Colour of one pixel of the last drawn picture (RGBA), valid in the task that drew it. For tests and probes. */
  public readPixel(x: number, y: number): [number, number, number, number] {
    if (this.gl && !this.contextLost) {
      const out = new Uint8Array(4);
      this.gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
      return [out[0], out[1], out[2], out[3]];
    }
    const data = this.ctx2d?.getImageData(x, y, 1, 1).data;
    return data ? [data[0], data[1], data[2], data[3]] : [0, 0, 0, 0];
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.restoreTimer);
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }
    this.closeFrame(this.pending);
    this.closeFrame(this.current);
    this.pending = this.current = null;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.gl && this.resources) {
      this.gl.deleteTexture(this.resources.texture);
      this.gl.deleteProgram(this.resources.program);
    }
    // The GPU process keeps the context (and its textures) until the canvas is collected, which can take long
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    // and the backing store of the detached canvas stays allocated until it is collected as well
    this.canvas.width = this.canvas.height = 0;
    this.resources = null;
    const holder = window as unknown as { __yallVideoStats?: VideoSurfaceStats };
    if (holder.__yallVideoStats === this.stats) {
      delete holder.__yallVideoStats;
    }
  }

  private closeFrame(frame: VideoFrame | null): void {
    if (frame) {
      frame.close();
      this.stats.closed++;
    }
  }

  private redraw(): void {
    if (this.current) {
      this.draw();
    }
  }

  private draw(): void {
    const frame = this.current;
    if (!frame || this.contextLost) {
      return;
    }
    try {
      if (this.gl) {
        this.drawGl(this.gl, frame);
      } else if (this.ctx2d) {
        this.draw2d(this.ctx2d, frame);
      }
      this.stats.drawn++;
    } catch (error) {
      this.stats.errors++;
      console.error('[VideoSurface] Drawing a frame failed:', error);
    }
  }

  private fit(frame: VideoFrame): FitRect {
    return computeFit({width: frame.displayWidth, height: frame.displayHeight}, this.canvas);
  }

  private draw2d(ctx: CanvasRenderingContext2D, frame: VideoFrame): void {
    const fit = this.fit(frame);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(frame, fit.x, fit.y, fit.width, fit.height);
  }

  private drawGl(gl: WebGL2RenderingContext, frame: VideoFrame): void {
    if (!this.resources) {
      this.createResources();
    }
    const resources = this.resources;
    if (!resources) {
      throw new Error('WebGL resources are unavailable');
    }
    if (!this.textureHoldsCurrent) {
      gl.bindTexture(gl.TEXTURE_2D, resources.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      this.textureHoldsCurrent = true;
    }
    const {width, height} = this.canvas;
    const fit = this.fit(frame);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(resources.program);
    gl.uniform4f(resources.rect,
      (fit.x / width) * 2 - 1, 1 - ((fit.y + fit.height) / height) * 2,
      ((fit.x + fit.width) / width) * 2 - 1, 1 - (fit.y / height) * 2);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private createResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    const program = gl.createProgram();
    const texture = gl.createTexture();
    if (!program || !texture) {
      this.stats.errors++;
      return;
    }
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        this.stats.errors++;
        console.error('[VideoSurface] Shader compile failed:', gl.getShaderInfoLog(shader));
        return;
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.stats.errors++;
      console.error('[VideoSurface] Program link failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);
    this.resources = {program, texture, rect: gl.getUniformLocation(program, 'uRect')!};
    this.textureHoldsCurrent = false;
  }
}
