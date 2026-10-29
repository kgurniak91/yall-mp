import {describe, expect, it} from 'vitest';
import {Libmpv, LibmpvEvent} from '../../libmpv-bridge';
import {describeNative, NativeEnv, SAMPLE_MP4, sleep, waitFor} from './support/native';

// Diagnostic only: which lavfi graphs this libmpv accepts (prints a table, never fails).
describeNative('lavfi filter probe', (env: NativeEnv) => {
  it('lists which graphs can be added', async () => {
    const player = await Libmpv.create(env.addon, {
      options: {
        vo: 'libmpv', ao: 'null', idle: 'yes', pause: 'no', 'keep-open': 'always', hwdec: 'no', 'terminal': 'no',
        'input-default-bindings': 'no', 'sub-visibility': 'no', 'loop-file': 'inf'
      },
      apiVersion: env.apiVersion
    });
    const messages: string[] = [];
    player.on('event', (event: LibmpvEvent) => {
      if (event.event === 'log-message') {
        messages.push(`[${event.prefix}/${event.level}] ${event.text.trim()}`);
      }
    });
    player.requestLogMessages('v');
    let frames = 0;
    await player.attachRenderer({backend: 'readback', impl: 'sw', width: 320, height: 180}, () => {
      frames++;
    });
    await player.command(['loadfile', SAMPLE_MP4, 'replace']);
    await waitFor(() => frames > 5, 15000, 'frames');

    const graphs = [
      'format=yuv420p', 'format=gbrpf32le', 'format=gbrp', 'null', 'scale', 'tonemap=tonemap=mobius', 'tonemap',
      'zscale', 'zscale=t=linear', 'zscale=t=linear:npl=203', 'zscale=p=bt709', 'zscale=m=bt709',
      'zscale=t=linear:npl=203,format=gbrpf32le', 'colorspace=all=bt709', 'lut=y=val', 'eq=gamma=1.0', 'geq=lum=lum(X\\,Y)'
    ];
    const rows: string[] = [];
    for (const graph of graphs) {
      messages.length = 0;
      let outcome = 'ok';
      try {
        await player.command(['vf', 'add', `@probe:lavfi=[${graph}]`]);
        await sleep(300);
        await player.command(['vf', 'remove', '@probe']).catch(() => undefined);
      } catch (error) {
        const tail = messages.filter(m => /lavfi|ffmpeg|filter|user_filter|vf\]/i.test(m)).slice(-3).join(' // ');
        outcome = `FAILED (${(error as Error).message}) ${tail}`;
      }
      rows.push(`${graph.padEnd(44)} ${outcome}`);
    }
    const version = async (name: string) => String(await player.getProperty(name).catch(() => '?'));
    console.log(`FILTER-PROBE mpv ${await version('mpv-version')} ffmpeg ${await version('ffmpeg-version')} platform ${process.platform}\n${rows.join('\n')}`);
    await player.destroy();
    expect(true).toBe(true);
  }, 120000);

  describe.skip('keeps the describe non-empty for the runner', () => undefined);
});
