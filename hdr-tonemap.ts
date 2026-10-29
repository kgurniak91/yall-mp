// mpv's software render API (readback on Linux and macOS, `impl: 'sw'`) converts the decoded picture with swscale and
// does no colour management: an HDR10 or HLG source would come out bright and oversaturated. The GPU renderers
// (D3D11, OpenGL) tone-map in mpv itself. For the software path the tone mapping is a video filter.
// Pure, so it can be unit tested.

export const TONE_MAP_LABEL = 'yall-tonemap';

/**
 * Linear light at 203 nits diffuse white, BT.709 primaries, mobius curve (linear up to 50 % of the range, then a smooth
 * roll-off, so diffuse white and the mid tones stay where an SDR picture has them), sRGB transfer, BT.709 matrix.
 */
export const TONE_MAP_FILTER =
  'lavfi=[zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.5:desat=0,' +
  'zscale=t=iec61966-2-1:m=bt709:r=tv,format=yuv420p]';

/** mpv's names of the two HDR transfer functions (`video-params/gamma`). */
const HDR_GAMMAS = ['pq', 'hlg'];

/** Whether the software renderer needs the tone mapping filter for a source with this transfer function. */
export function needsToneMapFilter(impl: string | undefined, gamma: unknown): boolean {
  return impl === 'sw' && typeof gamma === 'string' && HDR_GAMMAS.includes(gamma);
}

/** The command that adds the filter (`add`) or takes it out again (`remove`). */
export function toneMapCommand(add: boolean): string[] {
  return add ? ['vf', 'add', `@${TONE_MAP_LABEL}:${TONE_MAP_FILTER}`] : ['vf', 'remove', `@${TONE_MAP_LABEL}`];
}
