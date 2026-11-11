import {app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, session} from 'electron';
import path from 'path';
import * as fs from 'fs';
import {
  type DictionaryLanguages,
  loadDictionaryStore,
  planDictionarySwitches,
  type ProfileDictionary,
  resolveDictionaryLanguages,
  saveDictionaryStore
} from './dictionary-switches';

export interface LanguageSyncResult {
  success: true;
  lang: string;
  /** Installed dictionaries that declare no language and that the user has not given one yet */
  unknownDictionaries: string[];
}

export class YomitanManager {
  private extensionId: string | null = null;
  private extensionPath: string;
  private proxyWindow: BrowserWindow | null = null;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private requestIdCounter = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private requestQueue: Array<() => void> = [];
  private isProxyReady = false;
  private languageSync: Promise<unknown> = Promise.resolve();
  private recommendedSettings: Record<string, { modification: object }[]> | null = null;

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
    ipcMain.handle('yomitan:set-dictionary-languages', (_, languages) => this.setDictionaryLanguages(languages));
    ipcMain.handle('yomitan:invoke', (_, msg) => this.invokeExtension(msg));
    ipcMain.handle('yomitan:show-context-menu', (event, options) => this.showContextMenu(event, options));
    ipcMain.handle('yomitan:is-ready', () => this.isProxyReady);
  }

  public async showContextMenu(event: Electron.IpcMainInvokeEvent, options: {
    text: string,
    allowNotes: boolean
  }): Promise<string | null> {
    return new Promise((resolve) => {
      const template: MenuItemConstructorOptions[] = [];

      if (options.allowNotes) {
        template.push({
          label: `Add to Notes`,
          click: () => resolve('add-to-notes')
        });
      }

      template.push({
        label: `Search in Dictionary`,
        click: () => resolve('search-in-dictionary')
      });

      template.push({type: 'separator'});
      template.push({role: 'copy'});
      template.push({role: 'selectAll'});

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

  /**
   * Points Yomitan at the subtitle language: its language setting (text handling, deinflection), the recommended
   * settings for that language, and the dictionary switches remembered for it (see dictionary-switches.ts).
   */
  public setLanguageFull(languageIso: string): Promise<LanguageSyncResult> {
    if (!this.proxyWindow || !this.extensionId) {
      return Promise.reject('Yomitan extension not ready');
    }
    // One sync at a time: each one saves the switches the previous one left
    return this.serialised(() => this.syncLanguage(languageIso));
  }

  /**
   * Stores the languages the user gave to dictionaries that declare none. They are final: the only way to change one
   * is to delete the dictionary and import it again, which drops the answer (see resolveDictionaryLanguages).
   */
  public setDictionaryLanguages(languages: DictionaryLanguages): Promise<void> {
    return this.serialised(async () => {
      const store = loadDictionaryStore(this.getSwitchMemoryPath());
      for (const [title, language] of Object.entries(languages ?? {})) {
        if (typeof title === 'string' && typeof language === 'string' && language.length > 0) {
          store.dictionaryLanguages[title] = language;
        }
      }
      saveDictionaryStore(this.getSwitchMemoryPath(), store);
    });
  }

  /** One sync or store change at a time: each sync saves the switches the previous one left */
  private serialised<T>(work: () => Promise<T>): Promise<T> {
    const run = this.languageSync.then(work);
    this.languageSync = run.catch(() => undefined);
    return run;
  }

  private async syncLanguage(lang: string): Promise<LanguageSyncResult> {
    const inProfile = {scope: 'profile', optionsContext: {current: true}};
    try {
      const before = await this.callExtension('optionsGet', {optionsContext: {current: true}});
      const previousLanguage: string | null = before?.general?.language ?? null;
      const dictionaries: ProfileDictionary[] = (before?.dictionaries ?? []).map((d: any) => ({name: d.name, enabled: !!d.enabled}));

      const targets: object[] = [{action: 'set', path: 'general.language', value: lang, ...inProfile}];
      for (const recommendation of this.getRecommendedSettings()[lang] ?? []) {
        targets.push({...recommendation.modification, ...inProfile});
      }
      await this.callExtension('modifySettings', {source: 'yall-mp-sync', targets});

      const infos: { title: string; sourceLanguage?: string }[] = (await this.callExtension('getDictionaryInfo')) ?? [];
      const store = loadDictionaryStore(this.getSwitchMemoryPath());
      const languages = resolveDictionaryLanguages(infos, store.dictionaryLanguages);
      const plan = planDictionarySwitches({
        previousLanguage,
        language: lang,
        dictionaries,
        sourceLanguages: languages.sourceLanguages,
        memory: store.switches
      });
      try {
        saveDictionaryStore(this.getSwitchMemoryPath(), {switches: plan.memory, dictionaryLanguages: languages.dictionaryLanguages});
      } catch (e) {
        console.error('[YomitanManager] Could not save the dictionary switches:', e);
      }

      const switchTargets = dictionaries.flatMap((dictionary, i) => dictionary.enabled === plan.enabled[i] ? [] : [{
        action: 'set', path: `dictionaries[${i}].enabled`, value: plan.enabled[i], ...inProfile
      }]);
      if (switchTargets.length > 0) {
        await this.callExtension('modifySettings', {source: 'yall-mp-sync', targets: switchTargets});
        await this.callExtension('triggerDatabaseUpdated', {type: 'dictionary', cause: 'options'});
      }
      return {success: true, lang, unknownDictionaries: languages.unknown};
    } catch (e) {
      console.error('[YomitanManager] Language sync failed:', e);
      throw e;
    }
  }

  /** Sends one action to Yomitan's backend and returns its result, or throws the error it answered with. */
  private async callExtension(action: string, params: object = {}): Promise<any> {
    const response = await this.invokeExtension({action, params});
    if (response?.error) {
      throw new Error(`Yomitan ${action} failed: ${response.error.message ?? JSON.stringify(response.error)}`);
    }
    return response?.result;
  }

  private getRecommendedSettings(): Record<string, { modification: object }[]> {
    if (!this.recommendedSettings) {
      try {
        const file = path.join(this.extensionPath, 'data', 'recommended-settings.json');
        this.recommendedSettings = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch (e) {
        console.warn('[YomitanManager] Could not read the recommended settings:', e);
        return {};
      }
    }
    return this.recommendedSettings!;
  }

  private getSwitchMemoryPath(): string {
    return path.join(app.getPath('userData'), 'yomitan-dictionary-switches.json');
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
