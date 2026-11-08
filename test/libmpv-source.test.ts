import {describe, expect, it} from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {parseDigest, pickLibmpvAsset, resolveLatestLibmpv, matchesVendoredHeaders} = require('../scripts/libmpv-source');

const HASH = 'a'.repeat(64);

const release = (names: string[]) => ({
  tag_name: '20261201',
  assets: names.map(name => ({name, browser_download_url: `https://example.test/${name}`, digest: `sha256:${HASH}`}))
});

describe('libmpv source lookup', () => {
  it('picks the plain x86_64 mpv-dev archive and reads its date, commit and digest', () => {
    const asset = pickLibmpvAsset(release([
      'mpv-x86_64-20261201-git-abc1234.7z',
      'mpv-dev-x86_64-v3-20261201-git-abc1234.7z',
      'mpv-dev-x86_64-20261201-git-abc1234.7z'
    ]));
    expect(asset).toEqual({
      archive: 'mpv-dev-x86_64-20261201-git-abc1234.7z',
      url: 'https://example.test/mpv-dev-x86_64-20261201-git-abc1234.7z',
      sha256: HASH,
      date: '20261201',
      commit: 'abc1234',
      tag: '20261201'
    });
  });

  it('never takes the AVX2 (v3) or the i686 archives, the old laptop has no AVX2', () => {
    expect(pickLibmpvAsset(release(['mpv-dev-x86_64-v3-20261201-git-abc1234.7z', 'mpv-dev-i686-20261201-git-abc1234.7z']))).toBeNull();
  });

  it('has no sha256 when GitHub shows no digest or another algorithm', () => {
    expect(parseDigest(undefined)).toBeNull();
    expect(parseDigest('sha1:abc')).toBeNull();
    expect(parseDigest(`sha256:${HASH.toUpperCase()}`)).toBe(HASH);
  });

  it('returns null for a release without assets', () => {
    expect(pickLibmpvAsset({tag_name: 'x'})).toBeNull();
    expect(pickLibmpvAsset(null)).toBeNull();
  });

  it('resolves the latest release through the injected fetch', async () => {
    const asset = await resolveLatestLibmpv(async () => release(['mpv-dev-x86_64-20261201-git-abc1234.7z']));
    expect(asset.archive).toBe('mpv-dev-x86_64-20261201-git-abc1234.7z');
  });

  it('throws when the latest release has no libmpv archive, and when GitHub is unreachable', async () => {
    await expect(resolveLatestLibmpv(async () => release(['something-else.zip']))).rejects.toThrow(/no mpv-dev-x86_64 archive/);
    await expect(resolveLatestLibmpv(async () => {
      throw new Error('offline');
    })).rejects.toThrow('offline');
  });

  it('compares the build commit with the vendored header commit by prefix', () => {
    const vendored = 'dde0671072723c311df874a32dc4e48b5197ca62';
    expect(matchesVendoredHeaders({commit: 'dde0671072'}, vendored)).toBe(true);
    expect(matchesVendoredHeaders({commit: 'abc1234'}, vendored)).toBe(false);
    expect(matchesVendoredHeaders({commit: 'dde0671072'}, '')).toBe(false);
  });
});
