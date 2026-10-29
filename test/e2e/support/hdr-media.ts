import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Two small clips with the same six colour patches: an SDR one (sRGB transfer, BT.709) and an HDR10 one (PQ, BT.2020)
// whose patches are the same colours placed so that SDR white (255) sits at 203 nits (diffuse white). A player that
// tone-maps HDR10 for an SDR display shows the same picture, a little darker because the HDR range above diffuse white
// has to fit in too; it must not look grey (lifted blacks), clipped or desaturated.

export const WIDTH = 640;
export const HEIGHT = 360;
const FRAMES = 72;
const FPS = 24;

/** sRGB values of the patches, 3 columns x 2 rows. */
export const PATCHES: ReadonlyArray<readonly [number, number, number]> = [
  [255, 255, 255], [128, 128, 128], [40, 40, 40], [0, 0, 0],
  [255, 0, 0], [0, 160, 0], [30, 60, 220], [200, 200, 40]
];
export const PATCH_COLUMNS = 4;
export const PATCH_ROWS = 2;

const srgbToLinear = (c: number): number => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const pq = (nits: number): number => {
  const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  const y = Math.pow(Math.max(nits, 0) / 10000, m1);
  return Math.pow((c1 + c2 * y) / (1 + c3 * y), m2);
};

const yuv = (r: number, g: number, b: number, kr: number, kb: number): [number, number, number] => {
  const y = kr * r + (1 - kr - kb) * g + kb * b;
  return [y, (b - y) / (2 * (1 - kb)), (r - y) / (2 * (1 - kr))];
};

type PatchCodes = Array<[number, number, number]>;

/** SDR: the sRGB values as they are, BT.709 matrix, limited range, 8 bit. */
const sdrCodes = (): PatchCodes => PATCHES.map(([r, g, b]) => {
  const [y, cb, cr] = yuv(r / 255, g / 255, b / 255, 0.2126, 0.0722);
  return [Math.round(16 + 219 * y), Math.round(128 + 224 * cb), Math.round(128 + 224 * cr)];
});

/** HDR10: the same colours as light (SDR white = 203 nits), converted to BT.2020 primaries, PQ encoded, limited range, 10 bit. */
const hdrCodes = (): PatchCodes => PATCHES.map(([r8, g8, b8]) => {
  const [r, g, b] = [r8, g8, b8].map(v => srgbToLinear(v / 255) * 203);
  const r2 = 0.627404 * r + 0.329283 * g + 0.043313 * b;
  const g2 = 0.069097 * r + 0.919540 * g + 0.011362 * b;
  const b2 = 0.016391 * r + 0.088013 * g + 0.895595 * b;
  const [y, cb, cr] = yuv(pq(r2), pq(g2), pq(b2), 0.2627, 0.0593);
  return [Math.round(64 + 876 * y), Math.round(512 + 896 * cb), Math.round(512 + 896 * cr)];
});

/** One 4:2:0 frame of the patch grid. `bytes` is 1 for 8 bit and 2 for 10 bit little endian. */
function frameOf(codes: PatchCodes, bytes: 1 | 2): Buffer {
  const lumaSize = WIDTH * HEIGHT;
  const chromaSize = lumaSize / 4;
  const out = Buffer.alloc((lumaSize + 2 * chromaSize) * bytes);
  const put = (offset: number, value: number): void => bytes === 1 ? void (out[offset] = value) : void out.writeUInt16LE(value, offset * 2);
  // patch edges at even pixels so the 4:2:0 chroma never straddles two patches
  const columnOf = (x: number): number => Math.min(PATCH_COLUMNS - 1, Math.floor(x / 2 / (WIDTH / 2 / PATCH_COLUMNS)));
  const rowOf = (y: number): number => Math.min(PATCH_ROWS - 1, Math.floor(y / (HEIGHT / PATCH_ROWS)));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      put(y * WIDTH + x, codes[rowOf(y) * PATCH_COLUMNS + columnOf(x)][0]);
    }
  }
  for (let y = 0; y < HEIGHT / 2; y++) {
    for (let x = 0; x < WIDTH / 2; x++) {
      const patch = codes[rowOf(y * 2) * PATCH_COLUMNS + columnOf(x * 2)];
      put(lumaSize + y * (WIDTH / 2) + x, patch[1]);
      put(lumaSize + chromaSize + y * (WIDTH / 2) + x, patch[2]);
    }
  }
  return out;
}

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bundled = require('ffmpeg-static') as string | null;
  // A checkout whose install scripts did not run has no bundled binary: use the one on the PATH
  return bundled && fs.existsSync(bundled) ? bundled : 'ffmpeg';
}

function encode(raw: string, pixFmt: string, out: string, codecArgs: string[]): void {
  execFileSync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-stream_loop', String(FRAMES - 1), '-f', 'rawvideo', '-pix_fmt', pixFmt, '-s', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', raw,
    '-frames:v', String(FRAMES), ...codecArgs, out
  ], {stdio: 'pipe'});
}

export interface HdrClips {
  /** sRGB / BT.709, 8 bit h264. */
  sdr: string;
  /** PQ / BT.2020, 10 bit hevc (HDR10 without mastering metadata). */
  hdr: string;
}

/** Generates the clips once per machine (a few seconds); they are not committed. */
export function ensureHdrClips(): HdrClips {
  const dir = path.join(os.tmpdir(), 'yall-mp-e2e-hdr-v2');
  fs.mkdirSync(dir, {recursive: true});
  const sdr = path.join(dir, 'patches-sdr.mp4');
  const hdr = path.join(dir, 'patches-hdr10.mp4');
  if (!fs.existsSync(sdr)) {
    const raw = path.join(dir, 'sdr.yuv');
    fs.writeFileSync(raw, frameOf(sdrCodes(), 1));
    encode(raw, 'yuv420p', sdr, [
      '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv'
    ]);
  }
  if (!fs.existsSync(hdr)) {
    const raw = path.join(dir, 'hdr.yuv');
    fs.writeFileSync(raw, frameOf(hdrCodes(), 2));
    encode(raw, 'yuv420p10le', hdr, [
      '-c:v', 'libx265', '-crf', '6', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
      // mastering display and content light level of a typical 1000 nit title
      '-x265-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:log-level=error:' +
        'master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,400',
      '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-color_range', 'tv'
    ]);
  }
  return {sdr, hdr};
}
