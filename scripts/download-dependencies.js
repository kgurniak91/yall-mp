const fs = require('fs');
const path = require('path');
const https = require('https');
const {execFileSync} = require('child_process');
const pathTo7za = require('7zip-bin').path7za;

const RESOURCES_DIR = path.join(__dirname, '..', 'electron-resources');

const URLS = {
  win32: {
    mpv: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20251123/mpv-x86_64-v3-20251123-git-f6c1164.7z',
    audiowaveform: 'https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform-1.10.2-win64.zip'
  }
};

const preserveLicense = (sourceDir, destDir, binaryName) => {
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
    execFileSync(pathTo7za, ['x', archivePath, `-o${outputDir}`, '-y'], {stdio: 'inherit'});
  } catch (err) {
    throw new Error(`Extraction failed: ${err.message}`);
  }
};

async function main() {
  const platform = process.platform;

  // --- MAC / LINUX HANDLER ---
  if (platform !== 'win32') {
    console.log(`\n⚠️  Platform '${platform}' detected.`);
    console.log(`   Automated dependency download is strictly for Windows.`);
    console.log(`   Please install dependencies manually:\n`);

    if (platform === 'darwin') { // macOS
      console.log(`   brew install mpv`);
      console.log(`   brew tap bbc/audiowaveform`);
      console.log(`   brew install audiowaveform\n`);
    } else { // Linux
      console.log(`   sudo apt install mpv`);
      console.log(`   # For audiowaveform, see: https://github.com/bbc/audiowaveform\n`);
    }

    return;
  }

  // --- WINDOWS HANDLER ---
  const targetDir = path.join(RESOURCES_DIR, 'windows');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, {recursive: true});
  }

  console.log(`\nY'ALL MP: Setting up Windows binaries...`);

  // 1. MPV
  const mpvArchive = path.join(targetDir, 'mpv.7z');
  if (!fs.existsSync(path.join(targetDir, 'mpv.exe'))) {
    console.log(`Downloading MPV...`);
    await downloadFile(URLS.win32.mpv, mpvArchive);
    extractArchive(mpvArchive, targetDir);
    preserveLicense(targetDir, targetDir, 'mpv');
    fs.unlinkSync(mpvArchive);
  } else {
    console.log(`MPV found, skipping.`);
  }

  // 2. Audiowaveform
  const awArchive = path.join(targetDir, 'audiowaveform.zip');
  if (!fs.existsSync(path.join(targetDir, 'audiowaveform.exe'))) {
    console.log(`Downloading Audiowaveform...`);
    await downloadFile(URLS.win32.audiowaveform, awArchive);
    extractArchive(awArchive, targetDir);
    preserveLicense(targetDir, targetDir, 'audiowaveform');
    fs.unlinkSync(awArchive);
  } else {
    console.log(`Audiowaveform found, skipping.`);
  }

  console.log(`Windows dependencies ready.\n`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
