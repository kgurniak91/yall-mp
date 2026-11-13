// Finds the newest shinchiro mpv-dev archive (libmpv for Windows) for `YALL_MP_LIBMPV_LATEST=1` installs (the default is the
// pinned build in download-dependencies.js). Pure helpers plus one small GitHub API call, so the choice can be unit tested.
const https = require('https');

const LATEST_RELEASE_API = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest';

// Only the plain x86_64 build: the -v3 builds need AVX2 (the old target laptop has none), and the gcc/dev variants are not libmpv-2.dll.
const ASSET_PATTERN = /^mpv-dev-x86_64-(\d{8})-git-([0-9a-f]+)\.7z$/;

/** "sha256:<64 hex>" (the GitHub release asset digest) -> the hex, or null when it is missing or another algorithm. */
function parseDigest(digest) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(String(digest || ''));
  return match ? match[1].toLowerCase() : null;
}

/** The libmpv archive of a GitHub release object, or null when the release has none. */
function pickLibmpvAsset(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  for (const asset of assets) {
    const match = ASSET_PATTERN.exec(String(asset && asset.name));
    if (match) {
      return {
        archive: asset.name,
        url: asset.browser_download_url,
        sha256: parseDigest(asset.digest),
        date: match[1],
        commit: match[2],
        tag: release.tag_name
      };
    }
  }
  return null;
}

/** GET a JSON document (follows redirects, 15 s timeout). A GITHUB_TOKEN raises the anonymous rate limit of 60 requests per hour. */
function fetchJson(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const headers = {'User-Agent': 'YallMp-Installer', 'Accept': 'application/vnd.github+json'};
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const request = https.get(url, {headers, timeout: 15000}, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location && redirectsLeft > 0) {
        response.resume();
        return fetchJson(response.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`GitHub answered ${response.statusCode} for ${url}`));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`Could not read the answer of ${url}: ${err.message}`));
        }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`Timeout while asking ${url}`)));
    request.on('error', reject);
  });
}

/** The newest libmpv archive (see pickLibmpvAsset); throws when GitHub cannot be reached or has no such archive. */
async function resolveLatestLibmpv(getJson = fetchJson) {
  const release = await getJson(LATEST_RELEASE_API);
  const asset = pickLibmpvAsset(release);
  if (!asset) {
    throw new Error(`The latest shinchiro release (${release && release.tag_name}) has no mpv-dev-x86_64 archive`);
  }
  return asset;
}

/** True when the archive's mpv commit is the one the vendored headers were taken from (`vendoredCommit` is the full 40 characters). */
function matchesVendoredHeaders(asset, vendoredCommit) {
  const vendored = String(vendoredCommit || '');
  return vendored.length > 0 && (vendored.startsWith(asset.commit) || asset.commit.startsWith(vendored));
}

module.exports = {LATEST_RELEASE_API, ASSET_PATTERN, parseDigest, pickLibmpvAsset, fetchJson, resolveLatestLibmpv, matchesVendoredHeaders};
