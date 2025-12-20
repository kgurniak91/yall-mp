import {Injectable, signal} from '@angular/core';
import {SupportedLanguage} from '../../../model/project.types';

export interface YomitanLanguageSummary {
  name: string;
  iso: string;
  iso639_3: string;
  exampleText: string;
}

@Injectable({
  providedIn: 'root'
})
export class YomitanService {
  public readonly supportedLanguages = signal<YomitanLanguageSummary[]>([]);
  private languagesLoadedPromise: Promise<void> | null = null;
  private lastResult: { scanText: string; data: any } | null = null;
  private isElectronReady = false;

  async ensureLanguagesLoaded(): Promise<void> {
    if (this.languagesLoadedPromise) {
      return this.languagesLoadedPromise;
    }

    const waitForElectron = async (): Promise<void> => {
      for (let i = 0; i < 50; i++) {
        const ready = await (window.electronAPI as any).invokeExtensionReadyCheck();
        if (ready) {
          this.isElectronReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!this.isElectronReady) {
        throw new Error('Yomitan Manager failed to initialize in time.');
      }

      const response = await window.electronAPI.invokeExtension({
        action: 'getLanguageSummaries',
        params: {}
      });

      if (response && Array.isArray(response.result)) {
        const sorted = response.result.sort((a: any, b: any) => a.name.localeCompare(b.name));
        this.supportedLanguages.set(sorted);
        console.log('[YomitanService] Fetched languages:', sorted.length);
      }
    };

    this.languagesLoadedPromise = waitForElectron();
    return this.languagesLoadedPromise;
  }

  async findTerms(text: string): Promise<any> {
    const textToScan = this.getSmartScanText(text);

    // OPTIMIZATION: If the processed text is exactly the same as the last one, return cached data
    if (this.lastResult && this.lastResult.scanText === textToScan) {
      return this.lastResult.data;
    }

    console.log(`[Yomitan] Smart Scan: "${textToScan}" (Len: ${textToScan.length})`);

    const message = {
      action: 'termsFind',
      params: {
        text: textToScan,
        optionsContext: {current: true},
        details: {matchType: 'exact', deinflect: true}
      }
    };

    try {
      const data = await window.electronAPI.invokeExtension(message);
      this.lastResult = {scanText: textToScan, data};
      return data;
    } catch (e) {
      this.lastResult = null;
      throw e;
    }
  }

  async getDictionaryInfo(): Promise<any> {
    const message = {action: 'getDictionaryInfo', params: {}};
    return window.electronAPI.invokeExtension(message);
  }

  async getOptions(): Promise<any> {
    const message = {action: 'optionsGet', params: {optionsContext: {current: true}}};
    return window.electronAPI.invokeExtension(message);
  }

  async setLanguage(appLanguage: SupportedLanguage): Promise<void> {
    await this.ensureLanguagesLoaded();

    let targetIso = 'en';

    const directMatch = this.supportedLanguages().find(l => l.iso === appLanguage);

    if (directMatch) {
      targetIso = directMatch.iso;
    } else {
      if (appLanguage === 'other') {
        targetIso = 'en';
      } else {
        targetIso = appLanguage;
      }
    }

    const isValid = this.supportedLanguages().some(l => l.iso === targetIso);
    if (!isValid && this.supportedLanguages().length > 0) {
      console.warn(`[YomitanService] ISO '${targetIso}' not found in Yomitan. Fallback to 'en'.`);
      targetIso = 'en';
    }

    console.log(`[YomitanService] Syncing FULL language. App: ${appLanguage} -> Yomitan: ${targetIso}`);
    await window.electronAPI.setYomitanLanguageFull(targetIso);
  }

  getExtensionId(): Promise<string | null> {
    return window.electronAPI.getYomitanExtensionId();
  }

  getSettingsUrl(): Promise<string | null> {
    return window.electronAPI.getYomitanSettingsUrl();
  }

  private getSmartScanText(fullText: string): string {
    const MIN_SCAN_LENGTH = 16; // Standard Yomitan default
    const HARD_CAP_LENGTH = 64; // Safety brake to prevent sending too long text

    // Find the first delimiter (Space, punctuation, etc.)
    // \s = whitespace, \p{P} = unicode punctuation
    const delimiterRegex = /[\s\p{P}]/u;
    const match = fullText.match(delimiterRegex);

    // Calculate the length of the immediate word
    // If no delimiter found, the "word" is the rest of the string
    const firstWordLength = match?.index !== undefined ? match.index : fullText.length;

    // Use the Word Length if it's huge, otherwise use the default length
    let lengthToTake = Math.max(firstWordLength, MIN_SCAN_LENGTH);

    // Apply hard cap just in case fullText is a massive block of text with no spaces
    lengthToTake = Math.min(lengthToTake, HARD_CAP_LENGTH);

    return fullText.substring(0, lengthToTake);
  }
}
