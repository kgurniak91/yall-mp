const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const {execFileSync, fork} = require('child_process');
const pathTo7za = require('7zip-bin').path7za;

if (process.platform !== 'win32') {
  try {
    fs.chmodSync(pathTo7za, 0o755);
  } catch (err) {
    console.warn(`Could not set executable permissions for 7za: ${err.message}`);
  }
}

const RESOURCES_DIR = path.join(__dirname, '..', 'electron-resources');
const EXTENSIONS_DIR = path.join(RESOURCES_DIR, 'extensions');

const URLS = {
  yomitan: 'https://github.com/yomidevs/yomitan/releases/download/25.11.11.0/yomitan-chrome.zip',
  win32: {
    mpv: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261017/mpv-x86_64-20261017-git-dde0671072.7z',
    audiowaveform: 'https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform-1.10.2-win64.zip'
  }
};

// libmpv for the native addon (Windows). The mpv-dev archive is the same shinchiro build as the mpv CLI above,
// but shinchiro prunes old releases, so the first source is a mirror in this project's own releases.
// Bumping: change archive + sha256 + mirror tag together and re-run `node scripts/vendor-mpv-headers.js <commit>`
// (the commit of the archive) so that the vendored headers match, all in one commit.
const LIBMPV = {
  archive: 'mpv-dev-x86_64-20261017-git-dde0671072.7z',
  sha256: 'd6638b2b40561e6071627f39ad60a38e15721dc87a49f244b897911ea2edfd9f',
  sources: [
    'https://github.com/kgurniak91/yall-mp/releases/download/deps-mpv-dev-20261017/mpv-dev-x86_64-20261017-git-dde0671072.7z',
    'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261017/mpv-dev-x86_64-20261017-git-dde0671072.7z'
  ]
};

const preserveLicense = (sourceDir, destDir, binaryName) => {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const possibleNames = ['LICENSE', 'COPYING', 'GPL', 'Copyright'];
  const files = fs.readdirSync(sourceDir);

  for (const file of files) {
    if (possibleNames.some(name => file.toUpperCase().includes(name))) {
      const extension = path.extname(file);
      const newName = `${binaryName}-LICENSE${extension || '.txt'}`;
      fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, newName));
      console.log(`   📄 Saved license for ${binaryName}`);
    }
  }
};

const downloadFile = (url, destPath) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, {headers: {'User-Agent': 'YallMp-Installer'}}, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`Failed to download. Status Code: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    request.on('error', (err) => {
      fs.unlink(destPath, () => {
      });
      reject(err);
    });
  });
};

const sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('error', reject)
    .on('end', () => resolve(hash.digest('hex')));
});

/** Tries each source in turn; a download error or a sha256 mismatch moves on to the next. */
const downloadVerified = async (sources, destPath, sha256) => {
  const errors = [];
  for (const url of sources) {
    try {
      console.log(`   Downloading ${url}`);
      await downloadFile(url, destPath);
      const actual = await sha256File(destPath);
      if (actual === sha256) {
        return url;
      }
      throw new Error(`sha256 mismatch (expected ${sha256}, got ${actual})`);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
      console.warn(`   ⚠️  ${err.message}`);
      fs.rmSync(destPath, {force: true});
    }
  }
  throw new Error(`Could not download ${path.basename(destPath)} from any source:\n  ${errors.join('\n  ')}`);
};

const extractArchive = (archivePath, outputDir) => {
  console.log(`Extracting: ${path.basename(archivePath)}`);
  try {
    // -y assumes yes on all queries
    // -o{dir} specifies output directory
    execFileSync(pathTo7za, ['x', archivePath, `-o${outputDir}`, '-y'], {stdio: 'inherit'});
  } catch (err) {
    throw new Error(`Extraction failed: ${err.message}`);
  }
};

async function main() {
  const platform = process.platform;

  // --- SETUP DIRECTORIES ---
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, {recursive: true});
  }

  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, {recursive: true});
  }

  // --- DOWNLOAD YOMITAN (Cross-Platform) ---
  const yomitanDir = path.join(EXTENSIONS_DIR, 'yomitan');
  const yomitanZip = path.join(EXTENSIONS_DIR, 'yomitan.zip');

  if (!fs.existsSync(path.join(yomitanDir, 'manifest.json'))) {
    console.log(`\n📚 Setting up Yomitan Dictionary...`);

    // Clean up potential partial states
    if (fs.existsSync(yomitanDir)) {
      fs.rmSync(yomitanDir, {recursive: true, force: true});
    }

    console.log(`   Downloading Yomitan...`);
    await downloadFile(URLS.yomitan, yomitanZip);

    console.log(`   Extracting Yomitan...`);
    extractArchive(yomitanZip, yomitanDir);
    fs.unlinkSync(yomitanZip);

    console.log(`\n🔧 Applying Yomitan patches...`);
    // Execute the patch script as a separate process
    const patchScript = path.join(__dirname, 'patch-yomitan.js');
    if (fs.existsSync(patchScript)) {
      fork(patchScript);
    }

    console.log(`   ✅ Yomitan setup complete.`);
  } else {
    console.log(`\n✅ Yomitan already installed.`);
  }

  // --- PLATFORM SPECIFIC DEPENDENCIES ---
  if (platform !== 'win32') {
    console.log(`\n⚠️  Platform '${platform}' detected.`);
    console.log(`   Binaries (mpv/audiowaveform) skipped (Windows only).`);
    console.log(`   Please ensure mpv and audiowaveform are installed via package manager (brew/apt).`);
    return;
  }

  // --- WINDOWS HANDLER ---
  const winTargetDir = path.join(RESOURCES_DIR, 'windows');
  if (!fs.existsSync(winTargetDir)) {
    fs.mkdirSync(winTargetDir, {recursive: true});
  }

  console.log(`\nY'ALL MP: Setting up Windows binaries...`);

  // --- LIBMPV (native addon) ---
  const libmpvDll = path.join(winTargetDir, 'libmpv-2.dll');
  const libmpvStamp = `${libmpvDll}.version`;
  const libmpvVersion = `${LIBMPV.archive} ${LIBMPV.sha256}`;
  const stamped = fs.existsSync(libmpvStamp) ? fs.readFileSync(libmpvStamp, 'utf8').trim() : '';
  if (!fs.existsSync(libmpvDll) || stamped !== libmpvVersion) {
    console.log(`   Setting up libmpv (${LIBMPV.archive})...`);
    const libmpvArchive = path.join(winTargetDir, 'mpv-dev.7z');
    const tmpDir = path.join(winTargetDir, 'mpv-dev-tmp');
    try {
      const source = await downloadVerified(LIBMPV.sources, libmpvArchive, LIBMPV.sha256);
      console.log(`   Verified sha256 from ${source}`);
      fs.rmSync(tmpDir, {recursive: true, force: true});
      // only the dll is needed at runtime; the headers are vendored in native/yall-libmpv/include
      execFileSync(pathTo7za, ['e', libmpvArchive, 'libmpv-2.dll', `-o${tmpDir}`, '-y'], {stdio: 'inherit'});
      fs.copyFileSync(path.join(tmpDir, 'libmpv-2.dll'), libmpvDll);
      fs.writeFileSync(libmpvStamp, `${libmpvVersion}
`);
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
      fs.rmSync(libmpvArchive, {force: true});
    }
  } else {
    console.log(`   libmpv found, skipping.`);
  }

  // --- MPV ---
  const mpvArchive = path.join(winTargetDir, 'mpv.7z');
  if (!fs.existsSync(path.join(winTargetDir, 'mpv.exe'))) {
    console.log(`   Downloading MPV...`);
    await downloadFile(URLS.win32.mpv, mpvArchive);
    extractArchive(mpvArchive, winTargetDir);
    preserveLicense(winTargetDir, winTargetDir, 'mpv');
    fs.unlinkSync(mpvArchive);
  } else {
    console.log(`   mpv found, skipping.`);
  }

  // --- AUDIOWAVEFORM ---
  const awArchive = path.join(winTargetDir, 'audiowaveform.zip');
  if (!fs.existsSync(path.join(winTargetDir, 'audiowaveform.exe'))) {
    console.log(`   Downloading Audiowaveform...`);
    await downloadFile(URLS.win32.audiowaveform, awArchive);
    extractArchive(awArchive, winTargetDir);
    preserveLicense(winTargetDir, winTargetDir, 'audiowaveform');
    fs.unlinkSync(awArchive);
  } else {
    console.log(`   audiowaveform found, skipping.`);
  }

  // --- PRUNE UNUSED FFPROBE BINARIES ---
  const ffprobeBinDir = path.join(__dirname, '..', 'node_modules', 'ffprobe-static', 'bin');
  if (fs.existsSync(ffprobeBinDir)) {
    const platforms = ['darwin', 'linux', 'win32'];
    for (const p of platforms) {
      if (p !== platform) {
        const pDir = path.join(ffprobeBinDir, p);
        if (fs.existsSync(pDir)) {
          fs.rmSync(pDir, {recursive: true, force: true});
          console.log(`   🗑️  Pruned unused ffprobe binary for ${p}`);
        }
      }
    }
  }

  console.log(`\n🎉 All dependencies ready.\n`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
