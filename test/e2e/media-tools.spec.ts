import {expect, test} from './support/app';
import {fixture, seedProject} from './support/seed';
import {waitForPlayer} from './support/playback';

// The media IPC calls that rely on the bundled ffprobe/ffmpeg and on audiowaveform, on a file with several streams
// (5.1 audio and an embedded styled ASS track): track listing, subtitle extraction, the font cache and the waveform.
test.setTimeout(120_000);

test('track listing, embedded subtitle extraction, the font cache and the waveform work on an mkv', async ({launch}) => {
  const mkv = fixture('sample-5.1.mkv');
  const {ui} = await launch({seed: dir => seedProject(dir, {media: mkv, duration: 5})});
  await waitForPlayer(ui);

  const metadata = await ui.evaluate(file => (window as any).electronAPI.getMediaMetadata(file), mkv);
  expect(metadata.audioTracks.length).toBeGreaterThanOrEqual(1);
  expect(metadata.subtitleTracks.length).toBeGreaterThanOrEqual(1);
  const subtitleTrack = metadata.subtitleTracks[0];
  const audioTrack = metadata.audioTracks[0];

  const projectId = 'e2e-media-tools';
  const extracted = await ui.evaluate(
    ([id, file, index]) => (window as any).electronAPI.extractSubtitleTrack(id, file, index), [projectId, mkv, subtitleTrack.index] as const);
  expect(extracted.subtitles.length).toBeGreaterThan(0);
  expect(extracted.rawAssContent, 'an embedded ASS track comes back as ASS').toContain('[Events]');

  const fonts = await ui.evaluate(id => (window as any).electronAPI.getProjectFonts(id), projectId);
  expect(Array.isArray(fonts), 'the font cache of the extracted track can be read').toBe(true);

  const peaks = await ui.evaluate(
    ([id, file, index]) => (window as any).electronAPI.generateAudioPeaks(id, file, index), [projectId, mkv, audioTrack.index] as const);
  expect(peaks, 'audiowaveform produced peaks').not.toBeNull();
  expect(peaks.length).toBeGreaterThan(0);
});
