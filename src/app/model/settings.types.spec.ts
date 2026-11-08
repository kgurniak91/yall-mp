import {DEFAULT_GLOBAL_SETTINGS} from './settings.types';

describe('DEFAULT_GLOBAL_SETTINGS', () => {
  it('starts with the fast GPU video path on (it falls back to readback by itself)', () => {
    expect(DEFAULT_GLOBAL_SETTINGS.gpuVideoPath).toBeTrue();
  });
});
