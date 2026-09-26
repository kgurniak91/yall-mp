// Loudness normalization for exported Anki clips (ffmpeg `loudnorm`, EBU R128).
//
// Two passes per clip: the first measures the clip, the second applies the exact
// gain (`linear=true`), so every card comes out at the same loudness regardless of
// the source. Surround sources are mixed down to stereo *before* measuring, inside
// the same filter chain; ffmpeg scales a surround downmix down to avoid clipping,
// and normalizing afterwards restores the level.

export interface LoudnessTarget {
  /** Integrated loudness in LUFS. */
  integrated: number;
  /** True-peak ceiling in dBTP. */
  truePeak: number;
  /** Loudness range in LU. */
  range: number;
}

/** -16 LUFS is the usual target for speech content played on phones and laptops. */
export const ANKI_LOUDNESS_TARGET: LoudnessTarget = {integrated: -16, truePeak: -1.5, range: 11};

/** loudnorm resamples to 192 kHz internally; bring the output back to a normal rate. */
export const OUTPUT_SAMPLE_RATE = 48000;

/** Values reported by the measurement pass (`print_format=json`). */
export interface LoudnormMeasurement {
  inputIntegrated: number;
  inputTruePeak: number;
  inputRange: number;
  inputThreshold: number;
  targetOffset: number;
}

const DOWNMIX = 'aformat=channel_layouts=stereo';

function targetOptions(target: LoudnessTarget): string {
  return `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
}

/** Audio filter for the measurement pass (run with `-f null -`). */
export function buildLoudnormMeasureFilter(target: LoudnessTarget = ANKI_LOUDNESS_TARGET): string {
  return `${DOWNMIX},loudnorm=${targetOptions(target)}:print_format=json`;
}

/**
 * Audio filter for the encoding pass. Without a measurement (silent clip, or the
 * measurement failed) the clip is only mixed down, exactly as before.
 */
export function buildLoudnormApplyFilter(
  measurement: LoudnormMeasurement | null,
  target: LoudnessTarget = ANKI_LOUDNESS_TARGET
): string {
  if (!measurement) {
    return DOWNMIX;
  }
  const measured = [
    `measured_I=${measurement.inputIntegrated}`,
    `measured_TP=${measurement.inputTruePeak}`,
    `measured_LRA=${measurement.inputRange}`,
    `measured_thresh=${measurement.inputThreshold}`,
    `offset=${measurement.targetOffset}`,
  ].join(':');
  return `${DOWNMIX},loudnorm=${targetOptions(target)}:${measured}:linear=true,aresample=${OUTPUT_SAMPLE_RATE}`;
}

/**
 * Extracts the loudnorm JSON block from ffmpeg's stderr. Returns null when the
 * block is missing or contains non-finite values (ffmpeg prints "-inf" for silence).
 */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return null;
  }

  const read = (key: string): number | null => {
    const value = Number(parsed[key]);
    return Number.isFinite(value) ? value : null;
  };

  const inputIntegrated = read('input_i');
  const inputTruePeak = read('input_tp');
  const inputRange = read('input_lra');
  const inputThreshold = read('input_thresh');
  const targetOffset = read('target_offset');

  if (inputIntegrated === null || inputTruePeak === null || inputRange === null
    || inputThreshold === null || targetOffset === null) {
    return null;
  }

  return {inputIntegrated, inputTruePeak, inputRange, inputThreshold, targetOffset};
}
