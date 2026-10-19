// Spike preload (sandboxed): receives shared-texture VideoFrames and draws them onto #video-surface.
// Drawing runs in the preload world, which shares the DOM with the page.
const {ipcRenderer, sharedTexture, contextBridge} = require('electron');

const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const DRAW = arg('spike-draw') || '2d';

const stats = {
  draw: DRAW, sharedAvailable: !!sharedTexture?.setSharedTextureReceiver,
  received: 0, drawn: 0, rendererDropped: 0, fps: 0, longTasks: 0, longTaskMs: 0, maxGapMs: 0, errors: 0
};
let pending = null;
let lastDrawAt = 0;
let drawnThisSecond = 0;

const drawPaths = {};

function init2d(canvas) {
  const ctx = canvas.getContext('2d');
  return frame => {
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  };
}

function initWebgl(canvas) {
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false});
  const vs = `#version 300 es
    out vec2 uv;
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
      uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
      gl_Position = vec4(p, 0.0, 1.0);
    }`;
  const fs = `#version 300 es
    precision mediump float;
    uniform sampler2D tex; in vec2 uv; out vec4 o;
    void main() { o = texture(tex, uv); }`;
  const sh = (t, s) => {
    const x = gl.createShader(t);
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
    return x;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return frame => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

async function initWebgpu(canvas) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({device, format, alphaMode: 'opaque'});
  const module = device.createShaderModule({
    code: `
      struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
        var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
        var o: VOut;
        o.pos = vec4f(p[i], 0, 1);
        o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
        return o;
      }
      @group(0) @binding(0) var smp: sampler;
      @group(0) @binding(1) var tex: texture_external;
      @fragment fn fs(i: VOut) -> @location(0) vec4f {
        return textureSampleBaseClampToEdge(tex, smp, i.uv);
      }`
  });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {module, entryPoint: 'vs'},
    fragment: {module, entryPoint: 'fs', targets: [{format}]}
  });
  const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
  return frame => {
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{binding: 0, resource: sampler}, {binding: 1, resource: device.importExternalTexture({source: frame})}]
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store'}]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
}

// Readback variants: pixels arrive as BGRA bytes (IPC) or are copied out of a shared mapping (shm), then
// are uploaded with texSubImage2D into an RGBA8 texture (the shader swizzles).
const MODE = arg('spike-mode') || 'shared';
const READBACK = MODE.startsWith('readback');

function initReadbackGl(canvas) {
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false});
  const vs = `#version 300 es
    out vec2 uv;
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
      uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
      gl_Position = vec4(p, 0.0, 1.0);
    }`;
  const fs = `#version 300 es
    precision mediump float;
    uniform sampler2D tex; in vec2 uv; out vec4 o;
    void main() { o = vec4(texture(tex, uv).bgr, 1.0); }`;
  const sh = (t, s) => {
    const x = gl.createShader(t);
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
    return x;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let tw = 0, th = 0;
  return (data, w, h) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (w !== tw || h !== th) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      tw = w;
      th = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

let drawFn = null;
let readbackDraw = null;
let shmDirty = false;
let shmLastSeq = 0;
let shmBuf = null;
let shmAddon = null;

function finish(p) {
  if (!p.frame) return;
  try { p.frame.close(); } catch {}
  try { p.tex.release(); } catch {}
}

function readbackLoop() {
  requestAnimationFrame(readbackLoop);
  let w, h, data;
  if (MODE === 'readback-shm') {
    if (!shmDirty) return;
    shmDirty = false;
    if (!shmBuf) shmBuf = new Uint8Array(3840 * 2160 * 4);
    const t = performance.now();
    const [seq, sw, sh] = shmAddon.shmRead(shmBuf);
    stats.copyMsLast = performance.now() - t;
    if (!seq || seq === shmLastSeq) return;
    if (seq > shmLastSeq + 1) stats.rendererDropped += seq - shmLastSeq - 1;
    shmLastSeq = seq;
    w = sw;
    h = sh;
    data = shmBuf;
  } else {
    if (!pending) return;
    ({w, h, buf: data} = pending);
    pending = null;
  }
  const now = performance.now();
  if (lastDrawAt) stats.maxGapMs = Math.max(stats.maxGapMs, now - lastDrawAt);
  lastDrawAt = now;
  try {
    if (stats.drawn === 20) {
      const i = ((h >> 1) * w + (w >> 1)) * 4;
      ipcRenderer.send('renderer-log', `readback ${data?.constructor?.name} len=${data?.length} centre BGRA=${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]} ${w}x${h}`);
    }
    readbackDraw(data, w, h);
    stats.drawn++;
    drawnThisSecond++;
  } catch (e) {
    stats.errors++;
    if (stats.errors < 4) ipcRenderer.send('renderer-log', `readback draw error: ${e.message}`);
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (!pending || !drawFn) return;
  const p = pending;
  pending = null;
  const now = performance.now();
  if (lastDrawAt) stats.maxGapMs = Math.max(stats.maxGapMs, now - lastDrawAt);
  lastDrawAt = now;
  try {
    drawFn(p.frame);
    stats.drawn++;
    drawnThisSecond++;
  } catch (e) {
    stats.errors++;
    if (stats.errors < 4) ipcRenderer.send('renderer-log', `draw error: ${e.message}`);
  }
  finish(p);
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    ipcRenderer.send('video-size', w, h);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('video-surface');
  const hud = document.getElementById('hud');
  ipcRenderer.send('renderer-log', `mode=${MODE} sharedTexture available in sandboxed preload: ${stats.sharedAvailable}; draw=${DRAW}`);

  if (READBACK) {
    try {
      readbackDraw = initReadbackGl(canvas);
      if (MODE === 'readback-shm') {
        shmAddon = require(require('path').join(__dirname, 'addon', 'build', 'Release', 'yall_libmpv_poc.node'));
        let opened = false;
        ipcRenderer.on('shm-frame', () => {
          if (!opened) { shmAddon.shmOpen(arg('spike-shm')); opened = true; } // the mapping exists only once the renderer is attached
          stats.received++;
          shmDirty = true;
        });
      } else {
        ipcRenderer.on('frame', (_e, m) => {
          stats.received++;
          if (pending) stats.rendererDropped++; // latest frame wins
          pending = m;
        });
      }
    } catch (e) {
      ipcRenderer.send('renderer-log', `readback init failed (${MODE}): ${e.message}`);
      return;
    }
    new ResizeObserver(() => sizeCanvas(canvas)).observe(canvas);
    sizeCanvas(canvas);
    requestAnimationFrame(readbackLoop);
    setInterval(() => {
      stats.fps = drawnThisSecond;
      drawnThisSecond = 0;
      hud.textContent = `${MODE}  fps=${stats.fps}\nreceived=${stats.received} dropped=${stats.rendererDropped}\ncanvas=${canvas.width}x${canvas.height}`;
      ipcRenderer.send('renderer-stats', {...stats});
      stats.maxGapMs = 0;
    }, 1000);
    return;
  }

  if (!stats.sharedAvailable) return;

  try {
    drawFn = DRAW === 'webgpu' ? await initWebgpu(canvas) : DRAW === 'webgl' ? initWebgl(canvas) : init2d(canvas);
  } catch (e) {
    ipcRenderer.send('renderer-log', `draw init failed (${DRAW}): ${e.message}`);
    return;
  }

  sharedTexture.setSharedTextureReceiver(async ({importedSharedTexture}) => {
    stats.received++;
    let frame;
    try {
      frame = importedSharedTexture.getVideoFrame();
    } catch (e) {
      stats.errors++;
      importedSharedTexture.release();
      return;
    }
    if (pending) {
      // Latest frame wins.
      stats.rendererDropped++;
      finish(pending);
    }
    pending = {frame, tex: importedSharedTexture};
  });

  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        stats.longTasks++;
        stats.longTaskMs += e.duration;
      }
    }).observe({entryTypes: ['longtask']});
  } catch {}

  new ResizeObserver(() => sizeCanvas(canvas)).observe(canvas);
  sizeCanvas(canvas);
  requestAnimationFrame(loop);

  setInterval(() => {
    stats.fps = drawnThisSecond;
    drawnThisSecond = 0;
    hud.textContent = `draw=${DRAW}  fps=${stats.fps}\nreceived=${stats.received} dropped=${stats.rendererDropped}\ncanvas=${canvas.width}x${canvas.height}`;
    ipcRenderer.send('renderer-stats', {...stats});
    stats.maxGapMs = 0; // per-second maximum
  }, 1000);
});
