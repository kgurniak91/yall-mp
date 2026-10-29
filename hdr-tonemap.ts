// mpv's software render API (readback on Linux and macOS, `impl: 'sw'`) converts the decoded picture with swscale and
// does no colour management: an HDR10 or HLG source would come out bright and oversaturated. The GPU renderers
// (D3D11, OpenGL) tone-map in mpv itself. For the software path the tone mapping is a video filter.
// Pure, so it can be unit tested.

export const TONE_MAP_LABEL = 'yall-tonemap';

/** mpv's names of the two HDR transfer functions (`video-params/gamma`). */
const HDR_GAMMAS = ['pq', 'hlg'];

/**
 * Linear light at 203 nits diffuse white, BT.709 primaries, mobius curve (linear up to 50 % of the range, then a smooth
 * roll-off, so diffuse white and the mid tones stay where an SDR picture has them), sRGB transfer, BT.709 matrix.
 * Needs the `zscale` filter (ffmpeg built with zimg), which the Windows and most Linux builds have.
 */
const ZSCALE_FILTER =
  'lavfi=[zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.5:desat=0,' +
  'zscale=t=iec61966-2-1:m=bt709:r=tv,format=yuv420p]';

// Builds without zimg (the Homebrew ffmpeg on macOS) have no `zscale`. The same curve then runs per channel on the PQ
// signal in a lookup table: PQ decode, 203 nit diffuse white, the same mobius roll-off for a 1000 nit title, sRGB
// encode, then the BT.2020 to BT.709 primaries matrix applied to the encoded values (not to linear light, which the
// 16 bit integer pipeline cannot hold: close enough, neutral colours are untouched). PQ only: HLG is built to look
// right on an SDR screen as it is.
const PQ = {m1: 0.1593017578125, m2: 78.84375, c1: 0.8359375, c2: 18.8515625, c3: 18.6875};
const DIFFUSE_WHITE_NITS = 203;
const SIGNAL_PEAK_NITS = 1000;
const MOBIUS_TRANSITION = 0.5;

function lutExpression(): string {
  const peak = SIGNAL_PEAK_NITS / DIFFUSE_WHITE_NITS;
  const j = MOBIUS_TRANSITION;
  const a = -j * j * (peak - 1) / (j * j - 2 * j + peak);
  const b = (j * j - 2 * j * peak + peak) / Math.max(peak - 1, 1e-6);
  const k = (b * b + 2 * b * j + j * j) / (b - a);
  const n = (value: number): string => String(Number(value.toPrecision(10)));
  return [
    // PQ signal (0..1) -> light relative to diffuse white
    `st(0,pow(val/maxval,${n(1 / PQ.m2)}))`,
    `st(1,pow(max(ld(0)-${n(PQ.c1)},0)/max(${n(PQ.c2)}-${n(PQ.c3)}*ld(0),0.000001),${n(1 / PQ.m1)})*${n(10000 / DIFFUSE_WHITE_NITS)})`,
    // roll-off above the transition point, never above 1
    `st(2,min(if(lte(ld(1),${n(j)}),ld(1),${n(k)}*(ld(1)+${n(a)})/(ld(1)+${n(b)})),1))`,
    // sRGB encode
    `if(lte(ld(2),0.0031308),12.92*ld(2),1.055*pow(ld(2),${n(1 / 2.4)})-0.055)*maxval`
  ].join(';');
}

const LUT_FILTER =
  `lavfi=[format=gbrp16le,lutrgb=r='${lutExpression()}':g='${lutExpression()}':b='${lutExpression()}',` +
  'colorchannelmixer=rr=1.6605:rg=-0.5876:rb=-0.0728:gr=-0.1246:gg=1.1329:gb=-0.0083:br=-0.0182:bg=-0.1006:bb=1.1187,' +
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,' +
  'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv]';

/** The tone mapping graphs in the order they are tried. */
export const TONE_MAP_VARIANTS = [
  {name: 'zscale', filter: ZSCALE_FILTER, gammas: HDR_GAMMAS},
  {name: 'lut', filter: LUT_FILTER, gammas: ['pq']}
] as const;

export type ToneMapVariant = typeof TONE_MAP_VARIANTS[number];

/** Whether the software renderer needs a tone mapping filter for a source with this transfer function. */
export function needsToneMapFilter(impl: string | undefined, gamma: unknown): boolean {
  return impl === 'sw' && typeof gamma === 'string' && HDR_GAMMAS.includes(gamma);
}

/** The command that adds the filter (`add`, with the given variant) or takes it out again (`remove`). */
export function toneMapCommand(add: boolean, variant: ToneMapVariant = TONE_MAP_VARIANTS[0]): string[] {
  return add ? ['vf', 'add', `@${TONE_MAP_LABEL}:${variant.filter}`] : ['vf', 'remove', `@${TONE_MAP_LABEL}`];
}
