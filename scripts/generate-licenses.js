const checker = require('license-checker-rseidelsohn');
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, {recursive: true});
}

const PATHS = {
  json: path.join(PUBLIC_DIR, 'licenses.json'),
  txt: path.join(PUBLIC_DIR, 'THIRD-PARTY-NOTICES.txt')
};

// Skip purely build-time tools licenses:
const EXCLUDED_PACKAGES = [
  '@angular/cli',
  '@angular/compiler-cli',
  '@angular-devkit/build-angular',
  '@types/',
  'electron-builder',
  'electron', // Added manually below with proper attribution
  'jasmine',
  'karma',
  'ng-mocks',
  'nodemon',
  'concurrently',
  'typescript',
  'vitest',
  '7zip-bin',
  'wait-on',
  'rimraf',
  'copyfiles',
  '@ngneat/spectator',
  'license-checker-rseidelsohn',
  'ffprobe-static'
];

// Manual licenses (external binaries and frameworks)
const MANUAL_LICENSES = [
  {
    name: "electron",
    licenses: "MIT",
    repository: "https://github.com/electron/electron",
    publisher: "OpenJS Foundation",
    notice: "This application is built on the Electron framework.",
    licenseText: `Copyright (c) Electron contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
  },
  {
    name: "mpv",
    licenses: "GPLv2+",
    repository: "https://github.com/mpv-player/mpv",
    publisher: "The mpv developers",
    notice: "This application bundles a binary of mpv.",
    licenseText: "Distributed under the GPLv2 or later.\nSource code available at: https://github.com/mpv-player/mpv"
  },
  {
    name: "audiowaveform",
    licenses: "GPLv3",
    repository: "https://github.com/bbc/audiowaveform",
    publisher: "British Broadcasting Corporation",
    notice: "audiowaveform is a trademark of the BBC.",
    licenseText: "Distributed under the GPLv3.\nSource code available at: https://github.com/bbc/audiowaveform"
  },
  {
    name: "ffmpeg",
    licenses: "GPLv3",
    repository: "https://ffmpeg.org",
    publisher: "FFmpeg Team",
    notice: "This application bundles binaries of FFmpeg and FFprobe (ffmpeg.org) licensed under the GPLv3.",
    licenseText: "This software uses code of FFmpeg licensed under the LGPLv2.1 and its source can be downloaded here: https://ffmpeg.org"
  },
  {
    name: "yomitan",
    licenses: "GPLv3",
    repository: "https://github.com/yomidevs/yomitan",
    publisher: "yomidevs",
    notice: "This application bundles the Yomitan browser extension. The extension has been adapted to function within the Electron environment.",
    licenseText: "Distributed under the GPLv3.\nSource code available at: https://github.com/yomidevs/yomitan"
  }
];

// Combine devDependencies and dependencies from package.json
const PACKAGE_JSON_DEPENDENCIES = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {})
]);

console.log('🔍 Scanning dependencies...');

checker.init({
  start: path.join(__dirname, '..'),
  json: true,
  customPath: {
    licenseText: '',
    publisher: '',
    email: '',
    repository: ''
  }
}, (err, packages) => {
  if (err) {
    console.error('❌ License check failed:', err);
    process.exit(1);
  }

  const combinedList = generateJsonFile(packages);
  generateTextFile(combinedList);
});

function generateJsonFile(packages) {
  let combinedList = [];
  const processedNames = new Set();

  Object.keys(packages).forEach(key => {
    const pkg = packages[key];

    let packageName = '';
    if (key.startsWith('@')) {
      // Handle scoped packages: @angular/core@19.0.0 -> @angular/core
      const parts = key.split('@');
      packageName = `@${parts[1]}`;
    } else {
      // Handle normal packages: uuid@11.1.0 -> uuid
      packageName = key.split('@')[0];
    }

    // Must be a Direct Dependency (listed in package.json)
    if (!PACKAGE_JSON_DEPENDENCIES.has(packageName)) {
      return;
    }

    // Must NOT be in the Blocklist (Build tools)
    // Check exact match OR starts with (for @types/ etc.)
    const isExcluded = EXCLUDED_PACKAGES.some(excluded =>
      packageName === excluded || packageName.startsWith(excluded)
    );

    if (isExcluded) {
      return;
    }

    if (processedNames.has(packageName)) {
      // Package already processed (perhaps a different version), skip to avoid duplicates.
      return;
    }
    processedNames.add(packageName);

    combinedList.push({
      name: key,
      licenses: pkg.licenses,
      repository: pkg.repository,
      publisher: pkg.publisher,
      licenseText: pkg.licenseText || "See repository for license details."
    });
  });

  MANUAL_LICENSES.forEach(manualPkg => {
    // Check if license already exists (e.g. ffmpeg-static might be in npm)
    // If it exists, override, otherwise append the binary info
    const existingIndex = combinedList.findIndex(p => p.name.startsWith(manualPkg.name));

    if (existingIndex > -1) {
      combinedList[existingIndex] = {...combinedList[existingIndex], ...manualPkg};
    } else {
      combinedList.push(manualPkg);
    }
  });

  // Sort alphabetically
  combinedList.sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(PATHS.json, JSON.stringify(combinedList, null, 2));
  console.log(`✅ Licenses JSON file generated at: ${PATHS.json}`);

  return combinedList;
}

function generateTextFile(combinedList) {
  const header = `Y'ALL MP - THIRD PARTY NOTICES
Generated: ${new Date().toISOString()}
========================================================================
This software includes the following third-party open source components.
The license terms for each component are listed below.
========================================================================\n\n`;

  const txtContent = combinedList.map(pkg => {
    const repo = pkg.repository ? `Source: ${pkg.repository}\n` : '';
    const pub = pkg.publisher ? `Publisher: ${pkg.publisher}\n` : '';

    return `COMPONENT: ${pkg.name}
LICENSE: ${pkg.licenses}
${pub}${repo}
------------------------------------------------------------------------
${pkg.licenseText ? pkg.licenseText.trim() : 'License text not available.'}
------------------------------------------------------------------------
\n`;
  }).join('\n');

  fs.writeFileSync(PATHS.txt, header + txtContent);
  console.log(`✅ Licenses TEXT file generated at: ${PATHS.txt}`);
}
