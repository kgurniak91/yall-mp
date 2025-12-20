import {app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, session} from 'electron';
import path from 'path';
import * as fs from 'fs';

export class YomitanManager {
  private extensionId: string | null = null;
  private extensionPath: string;
  private proxyWindow: BrowserWindow | null = null;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private requestIdCounter = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private requestQueue: Array<() => void> = [];
  private isProxyReady = false;

  constructor() {
    const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    this.extensionPath = path.join(basePath, 'electron-resources', 'extensions', 'yomitan');

    // Listen for responses from the proxy window
    ipcMain.on('yomitan:proxy-response', (_, {requestId, error, result}) => {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        if (error) pending.reject(error);
        else pending.resolve(result);
        this.pendingRequests.delete(requestId);
      }
    });

    // Listen for the ready signal from the proxy window script
    ipcMain.on('yomitan:proxy-ready', () => {
      console.log('[YomitanManager] Proxy window signaled ready. Flushing queue...');
      this.isProxyReady = true;
      this.flushRequestQueue();
    });
  }

  public destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.proxyWindow && !this.proxyWindow.isDestroyed()) {
      this.proxyWindow.destroy();
    }
    this.proxyWindow = null;
    console.log('[YomitanManager] Destroyed.');
  }

  public registerHandlers() {
    ipcMain.handle('yomitan:get-settings-url', () => this.getSettingsUrl());
    ipcMain.handle('yomitan:get-extension-id', () => this.getExtensionId());
    ipcMain.handle('yomitan:set-language-full', (_, iso) => this.setLanguageFull(iso));
    ipcMain.handle('yomitan:invoke', (_, msg) => this.invokeExtension(msg));
    ipcMain.handle('yomitan:show-context-menu', (event) => this.showContextMenu(event));
    ipcMain.handle('yomitan:is-ready', () => this.isProxyReady);
  }

  public async showContextMenu(event: Electron.IpcMainInvokeEvent): Promise<string | null> {
    return new Promise((resolve) => {
      const template: MenuItemConstructorOptions[] = [
        {
          label: `Add to Notes`,
          click: () => {
            resolve('add-to-notes');
          }
        },
        {type: 'separator'},
        {role: 'copy'},
        {role: 'selectAll'}
      ];

      const menu = Menu.buildFromTemplate(template);
      const win = BrowserWindow.fromWebContents(event.sender);

      if (win) {
        menu.popup({
          window: win,
          callback: () => {
            // Resolve null if menu closes without action
            setTimeout(() => resolve(null), 10);
          }
        });
      } else {
        resolve(null);
      }
    });
  }

  public async loadExtension(): Promise<void> {
    const manifestPath = path.join(this.extensionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.warn(`[YomitanManager] Manifest not found at: ${manifestPath}`);
      return;
    }

    try {
      console.log(`[YomitanManager] Loading extension from: ${this.extensionPath}`);

      const ext = await session.defaultSession.extensions.loadExtension(this.extensionPath, {
        allowFileAccess: true
      });

      this.extensionId = ext.id;
      console.log(`[YomitanManager] Extension loaded: ${this.extensionId}`);

      this.createProxyWindow();
    } catch (e) {
      console.error('[YomitanManager] Failed to load extension:', e);
    }
  }

  private createProxyWindow() {
    if (!this.extensionId) {
      return;
    }

    if (this.proxyWindow && !this.proxyWindow.isDestroyed()) {
      this.proxyWindow.destroy();
    }

    this.isProxyReady = false;
    this.proxyWindow = new BrowserWindow({
      show: false,
      width: 0,
      height: 0,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      }
    });

    const proxyUrl = `chrome-extension://${this.extensionId}/search.html`;

    this.proxyWindow.webContents.on('did-finish-load', () => {
      this.proxyWindow?.webContents.executeJavaScript(`
        const { ipcRenderer } = require('electron');

        ipcRenderer.on('yomitan:proxy-request', (event, { requestId, message }) => {
          try {
            if (!window.chrome || !chrome.runtime) {
               ipcRenderer.send('yomitan:proxy-response', { requestId, error: 'Extension context invalidated' });
               return;
            }
            chrome.runtime.sendMessage(message, (response) => {
              const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
              ipcRenderer.send('yomitan:proxy-response', { requestId, error, result: response });
            });
          } catch (e) {
            ipcRenderer.send('yomitan:proxy-response', { requestId, error: e.message });
          }
        });

        async function verifyConnection() {
          for (let i = 0; i < 20; i++) {
            try {
              if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
                const response = await new Promise(r => chrome.runtime.sendMessage({ action: 'getDictionaryInfo' }, r));
                if (response) {
                  ipcRenderer.send('yomitan:proxy-ready');
                  return;
                }
              }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 500));
          }
          console.error("Yomitan connection failed after 20 attempts.");
        }
        verifyConnection();
        0; // Primitive return
      `);
      this.startHeartbeat();
    });

    this.proxyWindow.loadURL(proxyUrl);
  }

  // Keep the Service Worker alive by pinging it every 20 seconds
  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      // 'heartbeat' is a valid action in backend.js of Yomitan that returns void 0
      this.invokeExtension({action: 'heartbeat'}).catch(() => {
        // Suppress heartbeat errors
      });
    }, 20000);
  }

  public invokeExtension(message: any): Promise<any> {
    if (!this.extensionId) {
      return Promise.reject('Yomitan extension not ready');
    }

    return new Promise((resolve, reject) => {
      const task = () => {
        if (!this.proxyWindow || this.proxyWindow.isDestroyed()) {
          reject('Proxy window destroyed');
          return;
        }

        const requestId = this.requestIdCounter++;
        this.pendingRequests.set(requestId, {resolve, reject});

        // Timeout safety (10s)
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject('Yomitan request timed out');

            // Trigger self-healing on timeout
            this.handleProxyTimeout();
          }
        }, 10000);

        try {
          this.proxyWindow.webContents.send('yomitan:proxy-request', {requestId, message});
        } catch (e) {
          this.pendingRequests.delete(requestId);
          reject('Failed to send to proxy window: ' + e);
          this.handleProxyTimeout();
        }
      };

      if (this.isProxyReady) {
        task();
      } else {
        this.requestQueue.push(task);
      }
    });
  }

  private flushRequestQueue() {
    while (this.requestQueue.length > 0) {
      const task = this.requestQueue.shift();
      if (task) {
        task();
      }
    }
  }

  private handleProxyTimeout() {
    console.warn('[YomitanManager] Proxy timeout detected. Recycling proxy window...');
    this.createProxyWindow();
  }

  public setLanguageFull(languageIso: string): Promise<any> {
    if (!this.proxyWindow || !this.extensionId) {
      return Promise.reject('Yomitan extension not ready');
    }

    const requestId = this.requestIdCounter++;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {resolve, reject});

      const script = `
        (async () => {
            const requestId = ${requestId};
            const lang = "${languageIso}";
            const { ipcRenderer } = require('electron');

            try {
                // Helper to send settings updates
                const modifySettings = async (targets) => {
                    if (targets.length === 0) return;
                    await new Promise((res, rej) => {
                        chrome.runtime.sendMessage({
                            action: 'modifySettings',
                            params: { source: 'yall-mp-sync', targets: targets }
                        }, (resp) => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(resp));
                    });
                };

                // Fetch Recommended Settings
                const url = chrome.runtime.getURL('/data/recommended-settings.json');
                const response = await fetch(url);
                const allRecommendations = await response.json();
                const recs = allRecommendations[lang];

                const targets = [{
                    action: 'set', path: 'general.language', value: lang,
                    scope: 'profile', optionsContext: {current: true}
                }];

                if (recs && Array.isArray(recs)) {
                    for (const r of recs) {
                        targets.push({ ...r.modification, scope: 'profile', optionsContext: {current: true} });
                    }
                }

                await modifySettings(targets);

                // Auto-Toggle Dictionaries
                const infoMsg = await new Promise(r => chrome.runtime.sendMessage({ action: 'getDictionaryInfo', params: {} }, r));
                const dictInfos = infoMsg.result;

                const dictLangMap = {};
                for(const info of dictInfos) {
                    dictLangMap[info.title] = info.sourceLanguage || 'ja';
                }

                const optionsMsg = await new Promise(r => chrome.runtime.sendMessage({ action: 'optionsGetFull', params: {} }, r));
                const currentProfile = optionsMsg.result.profiles[optionsMsg.result.profileCurrent];
                const currentDicts = currentProfile.options.dictionaries;

                const dictTargets = [];
                for (let i = 0; i < currentDicts.length; i++) {
                    const dict = currentDicts[i];
                    const dictLang = dictLangMap[dict.name];
                    const shouldEnable = (dictLang === lang);

                    if (dict.enabled !== shouldEnable) {
                        dictTargets.push({
                            action: 'set',
                            path: \`dictionaries[\${i}].enabled\`,
                            value: shouldEnable,
                            scope: 'profile',
                            optionsContext: {current: true}
                        });
                    }
                }

                await modifySettings(dictTargets);

                if (dictTargets.length > 0) {
                    chrome.runtime.sendMessage({ action: 'triggerDatabaseUpdated', params: { type: 'dictionary', cause: 'options' } });
                }

                ipcRenderer.send('yomitan:proxy-response', { requestId, error: null, result: { success: true, lang } });

            } catch (e) {
                console.error("Yomitan setLanguageFull failed:", e);
                ipcRenderer.send('yomitan:proxy-response', { requestId, error: e.message || e.toString() });
            }
        })();
        0; // Primitive return
        `;

      this.proxyWindow?.webContents.executeJavaScript(script).catch(err => {
        this.pendingRequests.delete(requestId);
        reject(err);
      });
    });
  }

  public getExtensionId(): string | null {
    return this.extensionId;
  }

  public getSettingsUrl(): string | null {
    if (!this.extensionId) {
      return null;
    }
    return `chrome-extension://${this.extensionId}/settings.html`;
  }
}
