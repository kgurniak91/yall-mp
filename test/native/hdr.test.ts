import {afterEach, describe, expect, it} from 'vitest';
import {AttachRendererOptions, Libmpv, RenderFrame} from '../../libmpv-bridge';
import {needsToneMapFilter, toneMapCommand} from '../../hdr-tonemap';
import {EventLog, describeNative, NativeEnv, sleep, waitFor} from './support/native';
import {ensureHdrClips, PATCH_COLUMNS, PATCH_ROWS, PATCHES} from '../e2e/support/hdr-media';

type Rgb = [number, number, number];

// Readback is what Linux and macOS use by default, and on those it goes through mpv's software renderer: HDR10 has to come
// out tone-mapped for an SDR screen there too, not as the raw PQ signal (bright, clipped and oversaturated).
describeNative('HDR10 on the readback paths', (env: NativeEnv) => {
  const players: Libmpv[] = [];

  afterEach(async () => {
    await Promise.all(players.splice(0).map(p => p.destroy()));
  });

  /** Plays the clip paused at 1 s like the frame sender would set it up and returns the patch colours of the readback frame. */
  const patchColours = async (file: string, attach: Omit<AttachRendererOptions, 'width' | 'height'>, toneMap: boolean): Promise<{ colours: Rgb[]; events: string[] }> => {
    const player = await Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'yes', 'keep-open': 'always', hwdec: 'no', 'terminal': 'no',
        'input-default-bindings': 'no', 'sub-visibility': 'no', start: '1'
      },
      apiVersion: env.apiVersion
    });
    players.push(player);
    const log = new EventLog(player);
    player.observeProperty('video-params/gamma');
    let last: RenderFrame | undefined;
    const result = await player.attachRenderer({width: 320, height: 180, ...attach}, frame => {
      last = frame;
    });
    await player.command(['loadfile', file, 'replace']);
    await waitFor(() => last !== undefined, 15000, 'a frame');
    await waitFor(() => log.values('video-params/gamma').some(g => typeof g === 'string'), 10000, 'video-params/gamma');
    if (toneMap) {
      const gamma = log.values('video-params/gamma').filter(g => typeof g === 'string').pop();
      if (needsToneMapFilter(result.impl, gamma)) {
        await player.command(toneMapCommand(true));
      }
    }
    await sleep(300);
    log.clear();
    await player.command(['seek', '1', 'absolute+exact']);
    await sleep(800);
    const frame = last!;
    expect(frame.pixels).toBeDefined();
    const colours = PATCHES.map((_, index) => {
      const column = index % PATCH_COLUMNS;
      const row = Math.floor(index / PATCH_COLUMNS);
      const x = Math.floor(frame.width * (column + 0.5) / PATCH_COLUMNS);
      const y = Math.floor(frame.height * (row + 0.5) / PATCH_ROWS);
      const o = (y * frame.width + x) * 4;
      const px = frame.pixels!;
      return [px[o + 2], px[o + 1], px[o]] as Rgb;
    });
    return {colours, events: log.names()};
  };

  const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  const variants: Array<{ name: string; options: Partial<AttachRendererOptions> }> = [{name: 'sw', options: {impl: 'sw'}}];
  if (process.platform === 'win32') {
    variants.push({name: 'd3d11 on WARP', options: {impl: 'd3d11', adapter: 'warp'}});
  }

  describe.each(variants)('readback ($name)', ({options}) => {
    it('shows an HDR10 clip like the same picture in SDR', async () => {
      const clips = ensureHdrClips();
      const sdr = (await patchColours(clips.sdr, {backend: 'readback', ...options}, true)).colours;
      const hdr = (await patchColours(clips.hdr, {backend: 'readback', ...options}, true)).colours;
      const report = PATCHES.map((nominal, i) => `${JSON.stringify(nominal)} sdr=${JSON.stringify(sdr[i])} hdr=${JSON.stringify(hdr[i])}`).join('\n');
      const why = `\n${report}`;
      const [white, grey, dark, black, red, green, blue] = hdr;
      expect(luma(white), `white is bright${why}`).toBeGreaterThanOrEqual(190);
      expect(luma(black), `black stays black${why}`).toBeLessThanOrEqual(12);
      expect(luma(grey), `mid grey is mid grey${why}`).toBeGreaterThanOrEqual(100);
      expect(luma(grey), `mid grey is not lifted${why}`).toBeLessThanOrEqual(160);
      expect(luma(dark) < luma(grey), `dark < mid${why}`).toBe(true);
      expect(red[0] >= 150 && red[1] <= 50 && red[2] <= 50, `red stays saturated${why}`).toBe(true);
      expect(green[1] >= 100 && green[0] <= 50 && green[2] <= 50, `green stays saturated${why}`).toBe(true);
      expect(blue[2] >= 130 && blue[0] <= 70, `blue stays saturated${why}`).toBe(true);
      // The SDR clip never gets the filter and stays close to its nominal colours (the swscale conversion differs a little per platform)
      PATCHES.forEach((nominal, i) => expect(Math.max(...nominal.map((v, k) => Math.abs(v - sdr[i][k]))), `SDR patch ${i}${why}`).toBeLessThanOrEqual(40));
    }, 60000);
  });

  it('adding and taking out the filter while playing keeps the file playing', async () => {
    const clips = ensureHdrClips();
    const player = await Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'no', 'keep-open': 'always', hwdec: 'no', 'terminal': 'no',
        'input-default-bindings': 'no', 'sub-visibility': 'no', 'loop-file': 'inf'
      },
      apiVersion: env.apiVersion
    });
    players.push(player);
    const log = new EventLog(player);
    player.observeProperty('time-pos');
    let frames = 0;
    await player.attachRenderer({backend: 'readback', impl: 'sw', width: 320, height: 180}, () => {
      frames++;
    });
    await player.command(['loadfile', clips.hdr, 'replace']);
    await waitFor(() => frames > 5, 15000, 'frames');
    log.clear();
    await player.command(toneMapCommand(true));
    const before = frames;
    await waitFor(() => frames > before + 10, 10000, 'frames after the filter was added');
    // The playback state machine reads playback-restart and seek events: adding the filter must not look like a seek
    expect(log.names()).not.toContain('playback-restart');
    expect(log.names()).not.toContain('seek');
    await player.command(toneMapCommand(false));
    const afterRemove = frames;
    await waitFor(() => frames > afterRemove + 10, 10000, 'frames after the filter was removed');
    expect(log.has('shutdown')).toBe(false);
    expect(log.events.some(e => e.event === 'end-file')).toBe(false);
  }, 60000);
});
