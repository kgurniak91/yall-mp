// Vendors the mpv client API headers into native/yall-libmpv/include/mpv for one mpv commit.
// Usage: node scripts/vendor-mpv-headers.js <commit>   (short or full hash; use the same commit as the libmpv archive)
// The addon is always compiled against these headers, never against the ones inside a mpv-dev archive
// (the shinchiro archive lacks render_d3d11.h).
const fs = require('fs');
const path = require('path');
const https = require('https');

const HEADERS = ['client.h', 'render.h', 'render_d3d11.h', 'render_gl.h', 'stream_cb.h'];
const OUT_DIR = path.join(__dirname, '..', 'native', 'yall-libmpv', 'include', 'mpv');

const get = (url) => new Promise((resolve, reject) => {
  https.get(url, {headers: {'User-Agent': 'YallMp-Vendor'}}, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      return get(response.headers.location).then(resolve, reject);
    }
    if (response.statusCode !== 200) {
      response.resume();
      return reject(new Error(`GET ${url} failed with status ${response.statusCode}`));
    }
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', reject);
});

async function main() {
  const short = process.argv[2];
  if (!short) {
    console.error('Usage: node scripts/vendor-mpv-headers.js <mpv commit>');
    process.exit(1);
  }

  const commit = JSON.parse((await get(`https://api.github.com/repos/mpv-player/mpv/commits/${short}`)).toString());
  const fullHash = commit.sha;
  const date = commit.commit.committer.date;
  console.log(`Vendoring mpv headers from ${fullHash} (${date})`);

  fs.mkdirSync(OUT_DIR, {recursive: true});
  const urls = [];
  let iscNotice = '';
  for (const name of HEADERS) {
    const url = `https://raw.githubusercontent.com/mpv-player/mpv/${fullHash}/include/mpv/${name}`;
    const body = await get(url);
    fs.writeFileSync(path.join(OUT_DIR, name), body);
    urls.push(url);
    if (name === 'client.h') {
      // The licence notice is the first block comment of client.h.
      const match = body.toString().match(/\/\*([\s\S]*?)\*\//);
      iscNotice = match[1].split('\n').map((line) => line.replace(/^ \* ?/, '').replace(/^ ?\*?$/, '')).join('\n').trim();
    }
    console.log(`   ${name}`);
  }

  const doc = [
    '# Vendored mpv client API headers',
    '',
    'These headers are copied unmodified from the mpv repository and are the only mpv headers the addon is built against.',
    'Do not compile against the headers inside a mpv-dev archive (the shinchiro archive lacks `render_d3d11.h`).',
    '',
    `- Commit: \`${fullHash}\``,
    `- Commit date: ${date}`,
    '- Files:',
    ...urls.map((url) => `  - ${url}`),
    '',
    'To bump: `node scripts/vendor-mpv-headers.js <commit>` with the same commit as the libmpv archive pinned in `scripts/download-dependencies.js`, in one change.',
    '',
    '## Licence (ISC, from `client.h`)',
    '',
    '```',
    iscNotice,
    '```',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'VENDORED.md'), doc);
  console.log('Wrote VENDORED.md');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
