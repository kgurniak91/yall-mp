const fs = require('fs');
const path = require('path');
const https = require('https');
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
    mpv: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20251201/mpv-x86_64-20251201-git-72dbcf1.7z',
    audiowaveform: 'https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform-1.10.2-win64.zip'
  }
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

  console.log(`\n🎉 All dependencies ready.\n`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
