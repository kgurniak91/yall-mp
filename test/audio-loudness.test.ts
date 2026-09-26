import {describe, expect, it} from 'vitest';
import {
  buildLoudnormApplyFilter,
  buildLoudnormMeasureFilter,
  parseLoudnormMeasurement
} from '../shared/utils/audio-loudness';

const FFMPEG_STDERR = `
ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers
Input #0, matroska,webm, from 'episode.mkv':
  Stream #0:1(fre): Audio: eac3, 48000 Hz, 5.1(side), fltp
Output #0, null, to 'pipe:':
size=N/A time=00:00:03.20 bitrate=N/A speed=  61x
[Parsed_loudnorm_1 @ 0x7f8]
{
	"input_i" : "-27.53",
	"input_tp" : "-9.12",
	"input_lra" : "6.40",
	"input_thresh" : "-37.81",
	"output_i" : "-16.20",
	"output_tp" : "-1.50",
	"output_lra" : "6.10",
	"output_thresh" : "-26.45",
	"normalization_type" : "dynamic",
	"target_offset" : "0.20"
}
`;

describe('audio-loudness', () => {
  it('parses the loudnorm JSON block out of ffmpeg stderr', () => {
    expect(parseLoudnormMeasurement(FFMPEG_STDERR)).toEqual({
      inputIntegrated: -27.53,
      inputTruePeak: -9.12,
      inputRange: 6.4,
      inputThreshold: -37.81,
      targetOffset: 0.2,
    });
  });

  it('returns null for a silent clip (ffmpeg reports -inf)', () => {
    const silent = FFMPEG_STDERR.replace('"-27.53"', '"-inf"').replace('"-9.12"', '"-inf"');
    expect(parseLoudnormMeasurement(silent)).toBeNull();
  });

  it('returns null when stderr has no JSON block', () => {
    expect(parseLoudnormMeasurement('ffmpeg version 6.1.1\nsize=N/A time=00:00:03.20')).toBeNull();
    expect(parseLoudnormMeasurement('')).toBeNull();
  });

  it('mixes down to stereo before measuring', () => {
    expect(buildLoudnormMeasureFilter()).toBe(
      'aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'
    );
  });

  it('applies the measured values in linear mode and resamples to 48 kHz', () => {
    const filter = buildLoudnormApplyFilter(parseLoudnormMeasurement(FFMPEG_STDERR));
    expect(filter).toBe(
      'aformat=channel_layouts=stereo,'
      + 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-27.53:measured_TP=-9.12:measured_LRA=6.4:measured_thresh=-37.81:offset=0.2:linear=true,'
      + 'aresample=48000'
    );
  });

  it('falls back to a plain downmix without a measurement', () => {
    expect(buildLoudnormApplyFilter(null)).toBe('aformat=channel_layouts=stereo');
  });
});
