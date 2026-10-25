// Builds native/yall-libmpv with cmake-js against the installed Electron headers.
// Usage: node scripts/build-native.js [--debug] [--prebuild] [--arch=<arch>]
//   --prebuild  also copies the result to native/yall-libmpv/prebuilds/<platform>-<arch>/
// Env: CMAKE_PATH overrides the cmake binary, CMAKE_GENERATOR overrides the generator (default: CMake picks).
const fs = require('fs');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const ADDON_DIR = path.join(ROOT, 'native', 'yall-libmpv');
const MIN_CMAKE = [3, 20];

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const prebuild = args.includes('--prebuild');
const archArg = args.find((a) => a.startsWith('--arch='));
const arch = archArg ? archArg.split('=')[1] : process.arch;

const cmakeVersion = (cmakePath) => {
  try {
    const out = execFileSync(cmakePath, ['--version'], {encoding: 'utf8'});
    const match = out.match(/cmake version (\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  } catch {
    return null;
  }
};

const isOldCmake = (version) =>
  version[0] < MIN_CMAKE[0] || (version[0] === MIN_CMAKE[0] && version[1] < MIN_CMAKE[1]);

// Candidates in order: CMAKE_PATH, PATH, then the CMake bundled with Visual Studio (Windows).
const findCmake = () => {
  const candidates = [];
  if (process.env.CMAKE_PATH) {
    candidates.push(process.env.CMAKE_PATH);
  }
  candidates.push('cmake');
  if (process.platform === 'win32') {
    const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
      try {
        const installPath = execFileSync(vswhere, [
          '-latest', '-products', '*',
          '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property', 'installationPath'
        ], {encoding: 'utf8'}).trim();
        if (installPath) {
          candidates.push(path.join(installPath, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe'));
        }
      } catch {
        // vswhere is optional, fall through to the error below
      }
    }
  }

  const rejected = [];
  for (const candidate of candidates) {
    const version = cmakeVersion(candidate);
    if (!version) {
      continue;
    }
    if (isOldCmake(version)) {
      rejected.push(`${candidate} (${version.join('.')})`);
      continue;
    }
    return candidate === 'cmake' ? null : candidate; // null: let cmake-js use PATH
  }

  const hint = rejected.length ? ` Found only too old: ${rejected.join(', ')}.` : '';
  throw new Error(`CMake >= ${MIN_CMAKE.join('.')} is required to build the native addon.${hint} ` +
    'Install CMake (or the Visual Studio C++ CMake tools) or set CMAKE_PATH.');
};

const cmakePath = findCmake();
const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const cmakeJs = path.join(ROOT, 'node_modules', 'cmake-js', 'bin', 'cmake-js');

// yall_fdpass receives the descriptors of the host's dma-buf slots in the Electron process. It is optional: without
// it the player only loses the dma-buf backend, so a failed build is a warning. Returns the built file or null.
const buildFdpass = () => {
  const outDir = path.join(ADDON_DIR, 'build-fdpass');
  const cmakeJsArgs = [
    cmakeJs, 'compile', '-d', ADDON_DIR, '-O', outDir,
    '--runtime=electron', `--runtime-version=${electronVersion}`, `--arch=${arch}`,
    '--CDYALL_BUILD_FDPASS=ON', '--CDYALL_BUILD_HOST=OFF', '--CDYALL_BUILD_ADDON=OFF'
  ];
  if (debug) {
    cmakeJsArgs.push('--debug');
  }
  if (cmakePath) {
    cmakeJsArgs.push('--cmake-path', cmakePath);
  }
  console.log('Building yall_fdpass');
  const result = spawnSync(process.execPath, cmakeJsArgs, {stdio: 'inherit', cwd: ROOT});
  const built = path.join(outDir, debug ? 'Debug' : 'Release', 'yall_fdpass.node');
  if (result.status !== 0 || !fs.existsSync(built)) {
    console.warn('WARNING: yall_fdpass could not be built; the dma-buf video backend will be unavailable.');
    return null;
  }
  const dest = path.join(ADDON_DIR, 'build', 'Release', 'yall_fdpass.node');
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(built, dest);
  console.log(`Built ${dest}`);
  return dest;
};

// Linux has no in-process addon (libmpv cannot share Electron's process): build the plain
// CMake host executable instead, no cmake-js or Node headers involved.
if (process.platform === 'linux') {
  const buildDir = path.join(ADDON_DIR, 'build');
  const config = debug ? 'Debug' : 'Release';
  const cmake = cmakePath || 'cmake';
  console.log(`Building yall-mpv-host (linux-${arch}, ${config})`);
  const run = (cmakeArgs) => spawnSync(cmake, cmakeArgs, {stdio: 'inherit', cwd: ROOT});
  let step = run(['-S', ADDON_DIR, '-B', buildDir, `-DCMAKE_BUILD_TYPE=${config}`,
    '-DYALL_BUILD_ADDON=OFF', '-DYALL_BUILD_HOST=ON']);
  if (step.status === 0) {
    step = run(['--build', buildDir, '--target', 'yall-mpv-host', '--parallel']);
  }
  if (step.status !== 0) {
    process.exit(step.status || 1);
  }
  const builtHost = path.join(buildDir, 'yall-mpv-host');
  const hostDest = path.join(buildDir, 'Release', 'yall-mpv-host');
  fs.mkdirSync(path.dirname(hostDest), {recursive: true});
  fs.copyFileSync(builtHost, hostDest);
  fs.chmodSync(hostDest, 0o755);
  const fdpass = buildFdpass();
  if (prebuild) {
    const destDir = path.join(ADDON_DIR, 'prebuilds', `linux-${arch}`);
    fs.mkdirSync(destDir, {recursive: true});
    fs.copyFileSync(builtHost, path.join(destDir, 'yall-mpv-host'));
    fs.chmodSync(path.join(destDir, 'yall-mpv-host'), 0o755);
    if (fdpass) {
      fs.copyFileSync(fdpass, path.join(destDir, 'yall_fdpass.node'));
    }
    console.log(`Prebuild copied to ${destDir}`);
  }
  console.log(`Built ${hostDest}`);
  process.exit(0);
}

const cmakeJsArgs = [
  cmakeJs, 'compile',
  '-d', ADDON_DIR,
  '--runtime=electron',
  `--runtime-version=${electronVersion}`,
  `--arch=${arch}`
];
if (debug) {
  cmakeJsArgs.push('--debug');
}
if (cmakePath) {
  cmakeJsArgs.push('--cmake-path', cmakePath);
}
if (process.env.CMAKE_GENERATOR) {
  cmakeJsArgs.push('-G', process.env.CMAKE_GENERATOR);
}

console.log(`Building yall-libmpv for Electron ${electronVersion} (${process.platform}-${arch}${debug ? ', debug' : ''})`);
const result = spawnSync(process.execPath, cmakeJsArgs, {stdio: 'inherit', cwd: ROOT});
if (result.status !== 0) {
  process.exit(result.status || 1);
}

const builtNode = path.join(ADDON_DIR, 'build', debug ? 'Debug' : 'Release', 'yall_libmpv.node');
if (!fs.existsSync(builtNode)) {
  console.error(`Build finished but ${builtNode} does not exist.`);
  process.exit(1);
}

if (prebuild) {
  const destDir = path.join(ADDON_DIR, 'prebuilds', `${process.platform}-${arch}`);
  fs.mkdirSync(destDir, {recursive: true});
  fs.copyFileSync(builtNode, path.join(destDir, 'yall_libmpv.node'));
  console.log(`Prebuild copied to ${destDir}`);
}
console.log(`Built ${builtNode}`);
