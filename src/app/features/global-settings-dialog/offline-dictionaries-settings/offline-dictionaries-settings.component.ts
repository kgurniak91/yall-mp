import {Component, computed, ElementRef, inject, NO_ERRORS_SCHEMA, OnInit, signal, viewChild} from '@angular/core';
import {SpinnerComponent} from '../../../shared/components/spinner/spinner.component';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {AppStateService} from '../../../state/app/app-state.service';

@Component({
  selector: 'app-offline-dictionaries-settings',
  standalone: true,
  imports: [
    SpinnerComponent,
    Select,
    FormsModule
  ],
  schemas: [
    NO_ERRORS_SCHEMA // Needed for <webview> from Electron
  ],
  templateUrl: './offline-dictionaries-settings.component.html',
  styleUrl: './offline-dictionaries-settings.component.scss'
})
export class OfflineDictionariesSettingsComponent implements OnInit {
  protected readonly settingsUrl = signal<string | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isSyncing = signal(false);
  protected readonly selectedLanguage = signal<string>('en');
  private readonly yomitanService = inject(YomitanService);
  private readonly appStateService = inject(AppStateService);
  private readonly webview = viewChild<ElementRef>('wv');

  protected readonly languages = computed(() => {
    return this.yomitanService.supportedLanguages().map(l => ({
      name: `${l.name} (${l.iso})`,
      iso: l.iso
    }));
  });

  ngOnInit() {
    const project = this.appStateService.currentProject();
    const currentLang = project?.settings.subtitlesLanguage || 'other';
    this.selectedLanguage.set(currentLang === 'other' ? 'en' : currentLang);
    this.yomitanService.getSettingsUrl().then(url => {
      this.settingsUrl.set(url);
      if (!url) {
        this.isLoading.set(false);
      }
    });
  }

  async onLanguageChange(iso: string) {
    this.selectedLanguage.set(iso);
    this.isSyncing.set(true);
    try {
      await this.yomitanService.setLanguage(iso);
      const wv = this.webview()?.nativeElement as Electron.WebviewTag;
      if (wv) {
        wv.reload();
      }
    } finally {
      this.isSyncing.set(false);
    }
  }

  protected onWebviewDomReady() {
    const wv = this.webview()?.nativeElement as Electron.WebviewTag;
    if (!wv) {
      return;
    }

    wv.executeJavaScript(`
      if (!chrome.extension.isAllowedIncognitoAccess) {
        chrome.extension.isAllowedIncognitoAccess = (cb) => {
           if (cb) cb(false);
           return Promise.resolve(false);
        };
      }

      // Intercept clicks and use console.log bridge
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href && !link.href.startsWith('chrome-extension://') && !link.href.startsWith('javascript:')) {
          e.preventDefault();
          e.stopPropagation();
          // Use console.log as a bridge to the host
          console.log('YALL_OPEN_LINK::' + link.href);
        }
      }, true);

      0;
    `);

    wv.insertCSS(`
      /* Global UI Cleanup */
      .content-left { display: none !important; }
      .content-right { display: none !important; }
      .fab-container { display: none !important; }
      .content-center > h1 { display: none !important; } /* Hide 'Yomitan Settings' title */
      .page-loading-stalled-notification { display: none !important; }

      /* Hide ALL sections in the main area by default */
      .content-center > * { display: none !important; }

      /* Explicitly SHOW only the 'Dictionaries' section */
      .content-center > .heading-container:has(#dictionaries) {
        display: flex !important;
      }

      .content-center > .heading-container:has(#dictionaries) + .settings-group {
        display: block !important;
      }

      /* Layout & Centering */
      .content-center {
        padding: 20px !important;
        width: 100% !important;
        max-width: 900px !important;
        margin: 0 auto !important; /* Center horizontally */
      }
    `);

    // Listen for the specific console message
    wv.addEventListener('console-message', (e: any) => {
      if (e.message && e.message.startsWith('YALL_OPEN_LINK::')) {
        const url = e.message.substring('YALL_OPEN_LINK::'.length);
        if (url) {
          window.electronAPI.openInSystemBrowser(url);
        }
      }
    });

    wv.executeJavaScript(`window.scrollTo(0,0);`);

    this.isLoading.set(false);
  }
}
