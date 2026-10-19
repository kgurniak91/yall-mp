// Downloads the pinned shinchiro mpv-dev (libmpv) and mpv CLI builds into vendor/.
const fs = require('fs');
const path = require('path');
const https = require('https');
const {execFileSync} = require('child_process');
const sevenZip = require(path.join(__dirname, '..', '..', '..', 'node_modules', '7zip-bin')).path7za;

const TAG = '20261017';
const SUFFIX = `${TAG}-git-dde0671072`;
const BASE = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/${TAG}`;
const ARCHIVES = {
  'mpv-dev': `mpv-dev-x86_64-${SUFFIX}.7z`,
  'mpv': `mpv-x86_64-${SUFFIX}.7z`
};
const VENDOR = path.join(__dirname, '..', 'vendor');

const download = (url, dest) => new Promise((resolve, reject) => {
  const file = fs.createWriteStream(dest);
  https.get(url, {headers: {'User-Agent': 'libmpv-poc'}}, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      fs.unlinkSync(dest);
      return download(res.headers.location, dest).then(resolve, reject);
    }
    if (res.statusCode !== 200) {
      file.close();
      fs.unlinkSync(dest);
      return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
    }
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
  }).on('error', reject);
});

(async () => {
  fs.mkdirSync(VENDOR, {recursive: true});
  for (const [dir, name] of Object.entries(ARCHIVES)) {
    const out = path.join(VENDOR, dir);
    if (fs.existsSync(out) && fs.readdirSync(out).length) {
      console.log(`${dir}: already present`);
      continue;
    }
    const archive = path.join(VENDOR, name);
    console.log(`downloading ${name}`);
    await download(`${BASE}/${name}`, archive);
    execFileSync(sevenZip, ['x', archive, `-o${out}`, '-y'], {stdio: 'inherit'});
    fs.unlinkSync(archive);
  }

  // The shinchiro mpv-dev archive ships render.h but omits render_d3d11.h; take it from upstream at the same commit.
  const header = path.join(VENDOR, 'mpv-dev', 'include', 'mpv', 'render_d3d11.h');
  if (!fs.existsSync(header)) {
    await download('https://raw.githubusercontent.com/mpv-player/mpv/dde0671072/include/mpv/render_d3d11.h', header);
  }
  console.log('render_d3d11.h present:', fs.existsSync(header));
  const client = fs.readFileSync(path.join(VENDOR, 'mpv-dev', 'include', 'mpv', 'client.h'), 'utf8');
  console.log('client API version line:', client.match(/#define MPV_CLIENT_API_VERSION.*/)?.[0]);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
