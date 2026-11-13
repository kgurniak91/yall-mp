// Checks that a release can be cut, without changing anything. Used by the /release Claude Code skill; can be run by hand:
//   node scripts/release-preflight.js <version>      e.g. 0.9.9-beta (a leading "v" is ignored)
// Checks: version format, git state (master, clean, equal to origin/master, tag not taken), CI of HEAD, the dependency
// download URLs, and the pinned libmpv: its mirror copy is downloaded and checked against the pinned sha256.
// Prints one line per check and, at the end, the libmpv line for the release notes. Exit code 1 when a check failed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {URLS, LIBMPV} = require('./download-dependencies');

const REPO = path.resolve(__dirname, '..');
const version = String(process.argv[2] || '').replace(/^v/, '');
const tag = `v${version}`;
const failures = [];
const warnings = [];

const ok = (message) => console.log(`OK    ${message}`);
const fail = (message) => {
  failures.push(message);
  console.log(`FAIL  ${message}`);
};
const warn = (message) => {
  warnings.push(message);
  console.log(`WARN  ${message}`);
};
const run = (cmd, args) => execFileSync(cmd, args, {cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

/** Follows redirects; resolves with the final status code (HEAD), or downloads into `dest` when given. */
const request = (url, dest, redirectsLeft = 5) => new Promise((resolve, reject) => {
  const req = https.request(url, {method: dest ? 'GET' : 'HEAD', headers: {'User-Agent': 'YallMp-Release-Preflight'}, timeout: 30000}, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
      res.resume();
      return request(new URL(res.headers.location, url).toString(), dest, redirectsLeft - 1).then(resolve, reject);
    }
    if (!dest || res.statusCode !== 200) {
      res.resume();
      return resolve(res.statusCode);
    }
    const out = fs.createWriteStream(dest);
    res.pipe(out);
    out.on('finish', () => out.close(() => resolve(res.statusCode)));
    out.on('error', reject);
  });
  req.on('timeout', () => req.destroy(new Error(`timeout for ${url}`)));
  req.on('error', reject);
  req.end();
});

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function checkVersion() {
  const current = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    fail(`version "${process.argv[2] || ''}" is not like 0.9.9-beta or 1.0.0`);
  } else if (version === current) {
    fail(`package.json already has version ${current}`);
  } else {
    ok(`version ${current} -> ${version}`);
  }
}

function checkGit() {
  try {
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    branch === 'master' ? ok('on master') : fail(`on branch ${branch}, not master`);
    const dirty = run('git', ['status', '--porcelain']);
    dirty ? fail(`working tree is not clean:\n${dirty}`) : ok('working tree clean');
    run('git', ['fetch', '--quiet', 'origin', 'master', '--tags']);
    const head = run('git', ['rev-parse', 'HEAD']);
    const remote = run('git', ['rev-parse', 'origin/master']);
    head === remote ? ok(`HEAD = origin/master (${head.slice(0, 7)})`) : fail(`HEAD ${head.slice(0, 7)} differs from origin/master ${remote.slice(0, 7)}`);
    const localTag = run('git', ['tag', '--list', tag]);
    const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
    localTag || remoteTag ? fail(`tag ${tag} already exists${remoteTag ? ' on origin' : ' locally'}`) : ok(`tag ${tag} is free`);
    return head;
  } catch (err) {
    fail(`git: ${err.message}`);
    return null;
  }
}

function checkCi(head) {
  if (!head) {
    return;
  }
  try {
    const runs = JSON.parse(run('gh', ['run', 'list', '--commit', head, '--json', 'workflowName,status,conclusion,url', '--limit', '50']));
    if (runs.length === 0) {
      fail(`no CI runs for ${head.slice(0, 7)} yet`);
      return;
    }
    for (const r of runs) {
      if (r.status !== 'completed') {
        fail(`CI "${r.workflowName}" is ${r.status} (${r.url})`);
      } else if (r.conclusion !== 'success') {
        fail(`CI "${r.workflowName}" ended ${r.conclusion} (${r.url})`);
      } else {
        ok(`CI "${r.workflowName}" success`);
      }
    }
  } catch (err) {
    fail(`gh run list failed (is gh installed and logged in?): ${err.message}`);
  }
}

async function checkUrls() {
  const urls = [URLS.yomitan, ...Object.values(URLS.win32)];
  for (const url of urls) {
    try {
      const status = await request(url);
      status === 200 ? ok(`reachable: ${url}`) : fail(`${status} for ${url}`);
    } catch (err) {
      fail(`${url}: ${err.message}`);
    }
  }
}

async function checkLibmpv() {
  const [mirror, ...others] = LIBMPV.sources;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yall-preflight-'));
  const dest = path.join(tmp, LIBMPV.archive);
  try {
    const status = await request(mirror, dest);
    if (status !== 200) {
      fail(`libmpv mirror ${status}: ${mirror} (create the deps-mpv-dev-<date> pre-release first)`);
    } else {
      const actual = sha256File(dest);
      actual === LIBMPV.sha256 ? ok(`libmpv mirror matches the pinned sha256: ${mirror}`) : fail(`libmpv mirror sha256 ${actual} differs from the pin ${LIBMPV.sha256}`);
    }
  } catch (err) {
    fail(`libmpv mirror ${mirror}: ${err.message}`);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  for (const url of others) {
    try {
      const status = await request(url);
      status === 200 ? ok(`libmpv fallback reachable: ${url}`) : warn(`libmpv fallback ${status} (pruned upstream; the mirror covers it): ${url}`);
    } catch (err) {
      warn(`libmpv fallback ${url}: ${err.message}`);
    }
  }
}

(async () => {
  checkVersion();
  const head = checkGit();
  checkCi(head);
  await checkUrls();
  await checkLibmpv();
  const mirrorTag = /releases\/download\/([^/]+)\//.exec(LIBMPV.sources[0]);
  const build = LIBMPV.archive.replace(/\.7z$/, '');
  console.log('');
  console.log(`LIBMPV_NOTE: The Windows version ships libmpv from the shinchiro build ${build}` +
    (mirrorTag ? ` (copy: https://github.com/kgurniak91/yall-mp/releases/tag/${mirrorTag[1]}).` : '.'));
  console.log(`RESULT: ${failures.length ? `${failures.length} FAILED` : 'all checks passed'}${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  process.exit(failures.length ? 1 : 0);
})();
