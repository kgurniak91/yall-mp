// electron-builder afterPack hook: ffprobe-static ships a binary for every platform and architecture, and asarUnpack
// copies the whole folder into each package. Keep only the binary of the platform being packaged (macOS keeps both
// architectures: a universal or per-arch build is decided later).
const fs = require('fs');
const path = require('path');

const PLATFORM_DIR = {darwin: 'darwin', linux: 'linux', win32: 'win32'};

/** Folders under `bin/` to delete for the platform name given by electron-builder (`mac`, `linux`, `windows`). */
function foldersToRemove(platformName, arch) {
  const keep = platformName === 'mac' ? 'darwin' : platformName === 'windows' ? 'win32' : 'linux';
  const removed = Object.values(PLATFORM_DIR).filter(dir => dir !== keep).map(dir => path.join(dir));
  if (keep === 'linux' || keep === 'win32') {
    // A 64-bit package needs no 32-bit binary.
    const archDirs = {x64: 'x64', arm64: 'arm64', ia32: 'ia32'};
    for (const other of Object.values(archDirs).filter(dir => dir !== arch)) {
      removed.push(path.join(keep, other));
    }
  }
  return removed;
}

function findFfprobeBinFolders(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 8 || !fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.name === 'ffprobe-static' && fs.existsSync(path.join(full, 'bin'))) {
        found.push(path.join(full, 'bin'));
      } else {
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

exports.default = async function afterPack(context) {
  const arch = ({1: 'x64', 3: 'arm64', 0: 'ia32'})[context.arch] ?? 'x64';
  const platformName = context.electronPlatformName === 'darwin' ? 'mac' : context.electronPlatformName === 'win32' ? 'windows' : 'linux';
  const roots = [path.join(context.appOutDir, 'resources'), path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')];
  let removedFolders = 0;
  for (const root of roots) {
    for (const bin of findFfprobeBinFolders(root)) {
      for (const folder of foldersToRemove(platformName, arch)) {
        const target = path.join(bin, folder);
        if (fs.existsSync(target)) {
          fs.rmSync(target, {recursive: true, force: true});
          removedFolders++;
        }
      }
    }
  }
  console.log(`  • afterPack: removed ${removedFolders} unused ffprobe-static folder(s) for ${platformName}/${arch}`);
};
