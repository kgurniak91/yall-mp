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
  errors: number;
  contextLosses: number;
  canvasWidth: number;
  canvasHeight: number;
  lastFrameWidth: number;
  lastFrameHeight: number;
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
    backend: 'none', received: 0, drawn: 0, dropped: 0, errors: 0, contextLosses: 0,
    canvasWidth: 0, canvasHeight: 0, lastFrameWidth: 0, lastFrameHeight: 0
  };

  private readonly gl: WebGL2RenderingContext | null;
  private readonly ctx2d: CanvasRenderingContext2D | null = null;
  private resources: GlResources | null = null;
  private pending: VideoFrame | null = null;
  private current: VideoFrame | null = null;
  private frameRequest = 0;
  private disposed = false;
  private contextLost = false;
  private textureHoldsCurrent = false;
  private probeFrames = 0;
  private probeReport: ((black: boolean) => void) | null = null;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.resources = null;
    this.textureHoldsCurrent = false;
    this.stats.contextLosses++;
  };

  private readonly onContextRestored = (): void => {
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

  /** Takes ownership of `frame`: it is closed once it was replaced or drawn and replaced. */
  public present(frame: VideoFrame): void {
    if (this.disposed || this.stats.backend === 'none') {
      frame.close();
      return;
    }
    this.stats.received++;
    if (this.pending) {
      this.pending.close();
      this.stats.dropped++;
    }
    this.pending = frame;
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
    this.current?.close();
    this.current = frame;
    this.textureHoldsCurrent = false;
    this.stats.lastFrameWidth = frame.displayWidth;
    this.stats.lastFrameHeight = frame.displayHeight;
    this.draw();
    this.probeDrawnFrame();
  }

  /** Reports, for each of the next `frames` newly drawn frames, whether five points of the picture are black. */
  public startProbe(frames: number, report: (black: boolean) => void): void {
    this.probeFrames = frames;
    this.probeReport = report;
  }

  private probeDrawnFrame(): void {
    const report = this.probeReport;
    const frame = this.current;
    if (!report || this.probeFrames <= 0 || !frame || this.contextLost || !this.gl) {
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
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }
    this.pending?.close();
    this.current?.close();
    this.pending = this.current = null;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.gl && this.resources) {
      this.gl.deleteTexture(this.resources.texture);
      this.gl.deleteProgram(this.resources.program);
    }
    this.resources = null;
    const holder = window as unknown as { __yallVideoStats?: VideoSurfaceStats };
    if (holder.__yallVideoStats === this.stats) {
      delete holder.__yallVideoStats;
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
