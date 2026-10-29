import {afterEach, describe, expect, it} from 'vitest';
import {AttachRendererOptions, Libmpv, LibmpvEvent, RenderFrame} from '../../libmpv-bridge';
import {needsToneMapFilter, TONE_MAP_VARIANTS, ToneMapVariant, toneMapCommand} from '../../hdr-tonemap';
import {EventLog, describeNative, NativeEnv, sleep, waitFor} from './support/native';
import {ensureHdrClips, PATCH_COLUMNS, PATCH_ROWS, PATCHES} from '../e2e/support/hdr-media';

type Rgb = [number, number, number];

/** Runs the filter command; a refusal is reported with what mpv logged about it (which filter or option it did not like). */
const addToneMapFilter = async (player: Libmpv, messages: string[], variant: ToneMapVariant): Promise<void> => {
  try {
    await player.command(toneMapCommand(true, variant));
  } catch (error) {
    const version = async (name: string) => String(await player.getProperty(name).catch(() => '?'));
    const relevant = messages.filter(m => /vf|lavfi|zscale|tonemap|filter|ffmpeg|error|fail/i.test(m)).slice(-12);
    throw new Error(`${(error as Error).message}; mpv ${await version('mpv-version')}, ffmpeg ${await version('ffmpeg-version')}; ` +
      `mpv said: ${relevant.join(' | ') || '(nothing)'}`);
  }
};

// Readback is what Linux and macOS use by default, and on those it goes through mpv's software renderer: HDR10 has to come
// out tone-mapped for an SDR screen there too, not as the raw PQ signal (bright, clipped and oversaturated).
describeNative('HDR10 on the readback paths', (env: NativeEnv) => {
  const players: Libmpv[] = [];

  afterEach(async () => {
    await Promise.all(players.splice(0).map(p => p.destroy()));
  });

  /** Plays the clip paused at 1 s like the frame sender would set it up and returns the patch colours of the readback frame. */
  const patchColours = async (file: string, attach: Omit<AttachRendererOptions, 'width' | 'height'>, variant?: ToneMapVariant): Promise<{ colours: Rgb[]; events: string[] }> => {
    const player = await Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'yes', 'keep-open': 'always', hwdec: 'no', 'terminal': 'no',
        'input-default-bindings': 'no', 'sub-visibility': 'no', start: '1'
      },
      apiVersion: env.apiVersion
    });
    players.push(player);
    const log = new EventLog(player);
    const messages: string[] = [];
    player.on('event', (event: LibmpvEvent) => {
      if (event.event === 'log-message') {
        messages.push(`[${event.prefix}] ${event.text.trim()}`);
      }
    });
    player.requestLogMessages('v');
    player.observeProperty('video-params/gamma');
    let last: RenderFrame | undefined;
    const result = await player.attachRenderer({width: 320, height: 180, ...attach}, frame => {
      last = frame;
    });
    await player.command(['loadfile', file, 'replace']);
    await waitFor(() => last !== undefined, 15000, 'a frame');
    await waitFor(() => log.values('video-params/gamma').some(g => typeof g === 'string'), 10000, 'video-params/gamma');
    if (variant) {
      const gamma = log.values('video-params/gamma').filter(g => typeof g === 'string').pop();
      if (needsToneMapFilter(result.impl, gamma)) {
        await addToneMapFilter(player, messages, variant);
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

  // `slack`: how far a saturated primary may stray from pure (the lookup table filter applies the gamut matrix to encoded values)
  const variants: Array<{ name: string; options: Partial<AttachRendererOptions>; variant?: ToneMapVariant; slack: number }> = [
    {name: 'sw, zscale filter', options: {impl: 'sw'}, variant: TONE_MAP_VARIANTS[0], slack: 0},
    {name: 'sw, lookup table filter', options: {impl: 'sw'}, variant: TONE_MAP_VARIANTS[1], slack: 50}
  ];
  if (process.platform === 'win32') {
    variants.push({name: 'd3d11 on WARP', options: {impl: 'd3d11', adapter: 'warp'}, slack: 0});
  }

  describe.each(variants)('readback ($name)', ({options, variant, slack}) => {
    it('shows an HDR10 clip like the same picture in SDR', async (context) => {
      const clips = ensureHdrClips();
      const sdr = (await patchColours(clips.sdr, {backend: 'readback', ...options}, variant)).colours;
      let hdr: Rgb[];
      try {
        hdr = (await patchColours(clips.hdr, {backend: 'readback', ...options}, variant)).colours;
      } catch (error) {
        // The zscale graph needs an ffmpeg with zimg; the Homebrew build on macOS has none (the sender falls back to the lookup table graph)
        if (variant?.name === 'zscale' && /No such filter|error running command/.test((error as Error).message)) {
          context.skip();
        }
        throw error;
      }
      const report = PATCHES.map((nominal, i) => `${JSON.stringify(nominal)} sdr=${JSON.stringify(sdr[i])} hdr=${JSON.stringify(hdr[i])}`).join('\n');
      if (process.env.HDR_REPORT) {
        console.log(`HDRREPORT ${variant?.name}\n${report}`);
      }
      const why = `\n${report}`;
      const [white, grey, dark, black, red, green, blue] = hdr;
      expect(luma(white), `white is bright${why}`).toBeGreaterThanOrEqual(190);
      expect(luma(black), `black stays black${why}`).toBeLessThanOrEqual(12);
      expect(luma(grey), `mid grey is mid grey${why}`).toBeGreaterThanOrEqual(100);
      expect(luma(grey), `mid grey is not lifted${why}`).toBeLessThanOrEqual(160);
      expect(luma(dark) < luma(grey), `dark < mid${why}`).toBe(true);
      expect(red[0] >= 150 && red[1] <= 50 + slack && red[2] <= 50 + slack, `red stays saturated${why}`).toBe(true);
      expect(green[1] >= 100 && green[0] <= 50 + slack && green[2] <= 50 + slack, `green stays saturated${why}`).toBe(true);
      expect(blue[2] >= 130 && blue[0] <= 70 + slack, `blue stays saturated${why}`).toBe(true);
      // The SDR clip never gets the filter and stays close to its nominal colours (the swscale conversion differs a little per platform)
      PATCHES.forEach((nominal, i) => expect(Math.max(...nominal.map((v, k) => Math.abs(v - sdr[i][k]))), `SDR patch ${i}${why}`).toBeLessThanOrEqual(40));
    }, 60000);
  });

  it.each(TONE_MAP_VARIANTS.map(v => ({name: v.name, variant: v})))('adding and taking out the $name filter while playing keeps the file playing', async ({variant}) => {
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
    const messages: string[] = [];
    player.on('event', (event: LibmpvEvent) => {
      if (event.event === 'log-message') {
        messages.push(`[${event.prefix}] ${event.text.trim()}`);
      }
    });
    player.requestLogMessages('v');
    player.observeProperty('time-pos');
    let frames = 0;
    await player.attachRenderer({backend: 'readback', impl: 'sw', width: 320, height: 180}, () => {
      frames++;
    });
    await player.command(['loadfile', clips.hdr, 'replace']);
    await waitFor(() => frames > 5, 15000, 'frames');
    log.clear();
    try {
      await addToneMapFilter(player, messages, variant);
    } catch (error) {
      // No zscale in this ffmpeg (Homebrew on macOS): the lookup table graph is the one that runs there
      if (variant.name === 'zscale' && /No such filter|error running command/.test((error as Error).message)) {
        return;
      }
      throw error;
    }
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
