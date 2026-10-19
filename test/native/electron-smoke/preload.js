// Smoke preload (sandboxed): counts the frames it receives (shared textures or readback IPC), closes and releases
// them at once, and reports the totals plus a centre-pixel probe. It does not draw video; the 2d context is only
// used at 1 fps to read one pixel of a shared frame.
const {ipcRenderer, sharedTexture} = require('electron');

const READBACK_CHANNEL = 'libmpv:readback-frame';

const stats = {
  sharedAvailable: !!sharedTexture?.setSharedTextureReceiver,
  shared: 0, readback: 0, errors: 0, lastWidth: 0, lastHeight: 0, centre: null
};
let probeCanvas = null;
let probeCtx = null;
let lastProbeAt = 0;

function probeFrame(frame) {
  const now = performance.now();
  if (now - lastProbeAt < 1000) {
    return;
  }
  lastProbeAt = now;
  if (!probeCanvas) {
    probeCanvas = new OffscreenCanvas(1, 1);
    probeCtx = probeCanvas.getContext('2d', {willReadFrequently: true});
  }
  const w = frame.displayWidth || frame.codedWidth;
  const h = frame.displayHeight || frame.codedHeight;
  // draw only the centre pixel into a 1x1 canvas
  probeCtx.drawImage(frame, Math.floor(w / 2), Math.floor(h / 2), 1, 1, 0, 0, 1, 1);
  const d = probeCtx.getImageData(0, 0, 1, 1).data;
  stats.centre = [d[0], d[1], d[2], d[3]];
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('video-surface');
  const hud = document.getElementById('hud');

  if (stats.sharedAvailable) {
    sharedTexture.setSharedTextureReceiver(async ({importedSharedTexture}) => {
      stats.shared++;
      let frame;
      try {
        frame = importedSharedTexture.getVideoFrame();
        stats.lastWidth = frame.codedWidth;
        stats.lastHeight = frame.codedHeight;
        probeFrame(frame);
      } catch (e) {
        stats.errors++;
      } finally {
        try { frame?.close(); } catch {}
        try { importedSharedTexture.release(); } catch {}
      }
    });
  }

  ipcRenderer.on(READBACK_CHANNEL, (_e, m) => {
    stats.readback++;
    stats.lastWidth = m.width;
    stats.lastHeight = m.height;
    const now = performance.now();
    if (now - lastProbeAt >= 1000) {
      lastProbeAt = now;
      const i = ((m.height >> 1) * m.width + (m.width >> 1)) * 4;
      // BGRA -> RGBA
      stats.centre = [m.data[i + 2], m.data[i + 1], m.data[i], m.data[i + 3]];
    }
  });

  let lastSent = '';
  const sizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (`${w}x${h}` !== lastSent) {
      lastSent = `${w}x${h}`;
      ipcRenderer.send('smoke:video-size', w, h);
    }
  };
  new ResizeObserver(sizeCanvas).observe(canvas);
  sizeCanvas();

  setInterval(() => {
    hud.textContent = `shared=${stats.shared} readback=${stats.readback} ${stats.lastWidth}x${stats.lastHeight}`;
    ipcRenderer.send('smoke:stats', {...stats});
  }, 250);
});
