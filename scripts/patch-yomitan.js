const fs = require('fs');
const path = require('path');

const YOMITAN_PATH = path.join(__dirname, '..', 'electron-resources', 'extensions', 'yomitan');

function patchPermissionsUtil() {
  const filePath = path.join(YOMITAN_PATH, 'js', 'data', 'permissions-util.js');
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('/* ELECTRON_PATCH_START */')) {
    console.log('   ℹ️  permissions-util.js is already patched.');
  } else {
    console.log('   🔧 Patching permissions-util.js...');

    const mockImpl = `
      /* ELECTRON_PATCH_START */
      if (typeof chrome.permissions === 'undefined' || !chrome.permissions.getAll) {
          return Promise.resolve({
              permissions: ['clipboardRead', 'clipboardWrite', 'nativeMessaging', 'unlimitedStorage', 'offscreen'],
              origins: ['<all_urls>']
          });
      }
      /* ELECTRON_PATCH_END */
    `;

    const mockBool = `
      /* ELECTRON_PATCH_START */
      if (typeof chrome.permissions === 'undefined') {
          return Promise.resolve(true);
      }
      /* ELECTRON_PATCH_END */
    `;

    content = content.replace('export function getAllPermissions() {', `export function getAllPermissions() { ${mockImpl}`);
    content = content.replace('export function hasPermissions(permissions) {', `export function hasPermissions(permissions) { ${mockBool}`);
    content = content.replace('export function setPermissionsGranted(permissions, shouldHave) {', `export function setPermissionsGranted(permissions, shouldHave) { ${mockBool}`);

    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function patchBackend() {
  const filePath = path.join(YOMITAN_PATH, 'js', 'background', 'backend.js');
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('/* ELECTRON_PATCH_BACKEND_START */')) {
    console.log('   ℹ️  backend.js is already patched.');
  } else {
    console.log('   🔧 Patching backend.js...');

    const injectAtStart = (funcSignature, returnCode) => {
      const escapedSig = funcSignature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${escapedSig}\\s*\\{`);
      if (regex.test(content)) {
        content = content.replace(regex, `${funcSignature} { /* ELECTRON_PATCH_BACKEND_START */ ${returnCode} /* ELECTRON_PATCH_BACKEND_END */`);
      }
    };

    injectAtStart('_createTab(url)', `console.log("[Yomitan Electron] Mocking _createTab:", url); return Promise.resolve({ id: 1, windowId: 1, url: url, active: true });`);
    injectAtStart('_getTabById(tabId)', `return Promise.resolve({ id: tabId, windowId: 1, url: 'http://dummy', active: true });`);
    injectAtStart('_getAllTabs()', `return Promise.resolve([]);`);
    injectAtStart('_createWindow(createData)', `console.log("[Yomitan Electron] Mocking _createWindow"); return Promise.resolve({ id: 1, tabs: [{id: 1}] });`);
    injectAtStart('_updateWindow(windowId, updateInfo)', `return Promise.resolve({ id: windowId });`);
    injectAtStart('async _focusTab(tab)', `return Promise.resolve();`);

    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function patchRequestBuilder() {
  const filePath = path.join(YOMITAN_PATH, 'js', 'background', 'request-builder.js');
  if (!fs.existsSync(filePath)) {
    return;
  }

  const newContent = `
/*
 * ELECTRON COMPATIBLE REQUEST BUILDER
 * Patched by Y'ALL MP installer
 */
export class RequestBuilder {
    constructor() {}

    async prepare() {
        // No-op for Electron
    }

    async fetchAnonymous(url, init) {
        // Electron doesn't support declarativeNetRequest in the same way, so just perform a standard fetch.
        return fetch(url, init);
    }

    static async readFetchResponseArrayBuffer(response, onProgress) {
        if (!onProgress || !response.body) {
            const result = await response.arrayBuffer();
            if (onProgress) onProgress(true);
            return new Uint8Array(result);
        }

        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        const chunks = [];
        let received = 0;

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onProgress(false); // Indeterminate progress if no content-length
        }

        const result = new Uint8Array(received);
        let position = 0;
        for (const chunk of chunks) {
            result.set(chunk, position);
            position += chunk.length;
        }

        onProgress(true);
        return result;
    }
}
`;

  console.log('   🔧 Overwriting request-builder.js with Electron-compatible version...');
  fs.writeFileSync(filePath, newContent, 'utf8');
}

function patchManifest() {
  const filePath = path.join(YOMITAN_PATH, 'manifest.json');
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = false;

    if (manifest.permissions && manifest.permissions.includes('contextMenus')) {
      manifest.permissions = manifest.permissions.filter(p => p !== 'contextMenus');
      changed = true;
    }

    if (manifest.content_scripts) {
      delete manifest.content_scripts;
      changed = true;
    }

    if (changed) {
      console.log('   🔧 Patching manifest.json...');
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 4), 'utf8');
    } else {
      console.log('   ℹ️  manifest.json is already patched.');
    }
  } catch (e) {
    console.error('Error patching manifest:', e);
  }
}

function main() {
  if (!fs.existsSync(YOMITAN_PATH)) {
    console.error('❌ Yomitan directory not found. Run download-dependencies.js first.');
    return;
  }

  try {
    patchPermissionsUtil();
    patchBackend();
    patchRequestBuilder();
    patchManifest();
    console.log('✅ Yomitan patched successfully.');
  } catch (e) {
    console.error('❌ Error patching Yomitan:', e);
  }
}

main();
