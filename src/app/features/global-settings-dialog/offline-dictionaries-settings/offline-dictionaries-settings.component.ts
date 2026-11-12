import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  NO_ERRORS_SCHEMA,
  OnInit,
  signal,
  viewChild
} from '@angular/core';
import {SpinnerComponent} from '../../../shared/components/spinner/spinner.component';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {AppStateService} from '../../../state/app/app-state.service';
import {Message} from 'primeng/message';
import {Button} from 'primeng/button';
import {DialogService} from 'primeng/dynamicdialog';
import {take} from 'rxjs';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {DictionaryLanguageDialogComponent} from './dictionary-language-dialog/dictionary-language-dialog.component';
import {
  DictionaryLanguageDialogData,
  DictionaryLanguageDialogResult,
  DictionaryLanguageEntry
} from './dictionary-language-dialog/dictionary-language-dialog.types';

/** Console messages the script injected into the Yomitan settings page sends to this component */
const IMPORT_FINISHED = 'YALL_DICTIONARY_IMPORT_FINISHED';
const DELETE_FINISHED = 'YALL_DICTIONARY_DELETE_FINISHED';

@Component({
  selector: 'app-offline-dictionaries-settings',
  standalone: true,
  imports: [
    SpinnerComponent,
    Select,
    FormsModule,
    Message,
    Button
  ],
  schemas: [
    NO_ERRORS_SCHEMA // Needed for <webview> from Electron
  ],
  templateUrl: './offline-dictionaries-settings.component.html',
  styleUrl: './offline-dictionaries-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OfflineDictionariesSettingsComponent implements OnInit {
  protected readonly settingsUrl = signal<string | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isSyncing = signal(false);
  protected readonly selectedLanguage = signal<string>('en');
  /** Installed dictionaries that declare no language, with the language the user gave each */
  protected readonly dictionaryLanguages = signal<DictionaryLanguageEntry[]>([]);
  protected readonly unansweredCount = computed(() => this.dictionaryLanguages().filter(d => !d.language).length);
  protected readonly answeredCount = computed(() => this.dictionaryLanguages().filter(d => !!d.language).length);
  private readonly yomitanService = inject(YomitanService);
  private readonly appStateService = inject(AppStateService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly webview = viewChild<ElementRef>('wv');
  private isLanguageDialogOpen = false;
  private isListeningToWebview = false;

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
    void this.refreshDictionaryLanguages();
  }

  async onLanguageChange(iso: string) {
    this.selectedLanguage.set(iso);
    this.isSyncing.set(true);
    try {
      await this.yomitanService.setLanguage(iso);
      this.reloadWebview();
    } finally {
      this.isSyncing.set(false);
    }
  }

  protected onEditDictionaryLanguages() {
    this.openDictionaryLanguageDialog(this.dictionaryLanguages());
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

      // Yomitan shows a progress bar while it imports or deletes dictionaries and hides it when done: tell the host
      new MutationObserver(mutations => {
        for (const m of mutations) {
          const el = m.target;
          if (m.oldValue === null && el.hidden) {
            if (el.matches('.dictionary-import-progress')) console.log('${IMPORT_FINISHED}');
            if (el.matches('.dictionary-delete-progress')) console.log('${DELETE_FINISHED}');
          }
        }
      }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true});

      window.scrollTo(0, 0);
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

    this.isLoading.set(false);
    if (this.isListeningToWebview) {
      return; // dom-ready fires again after each reload of the page, the listener stays
    }
    this.isListeningToWebview = true;

    // Listen for the specific console message
    wv.addEventListener('console-message', (e: any) => {
      if (e.message && e.message.startsWith('YALL_OPEN_LINK::')) {
        const url = e.message.substring('YALL_OPEN_LINK::'.length);
        if (url) {
          window.electronAPI.openInSystemBrowser(url);
        }
      } else if (e.message === IMPORT_FINISHED) {
        void this.onImportFinished();
      } else if (e.message === DELETE_FINISHED) {
        void this.refreshDictionaryLanguages();
      }
    });
  }

  private async onImportFinished() {
    const before = new Set(this.dictionaryLanguages().map(d => d.title));
    await this.refreshDictionaryLanguages();
    // Ask right away about the old-format dictionaries this import added
    const added = this.dictionaryLanguages().filter(d => !d.language && !before.has(d.title));
    if (added.length > 0) {
      this.openDictionaryLanguageDialog(added);
    }
  }

  private async refreshDictionaryLanguages() {
    try {
      this.dictionaryLanguages.set(await this.yomitanService.getDictionaryLanguages());
    } catch (e) {
      console.warn('[OfflineDictionaries] Could not read the dictionary languages:', e);
    }
  }

  private openDictionaryLanguageDialog(dictionaries: DictionaryLanguageEntry[]) {
    if (dictionaries.length === 0 || this.isLanguageDialogOpen) {
      return;
    }
    this.isLanguageDialogOpen = true;
    const restoreFocusability = disableFocusInParentDialog();

    const data: DictionaryLanguageDialogData = {dictionaries, languages: this.languages()};
    const ref = this.dialogService.open(DictionaryLanguageDialogComponent, {
      header: 'Which language are these dictionaries for?',
      width: 'clamp(20rem, 95vw, 40rem)',
      modal: true,
      closable: true,
      closeOnEscape: false,
      data
    });

    ref.onClose.pipe(take(1)).subscribe(async (result: DictionaryLanguageDialogResult | undefined) => {
      this.isLanguageDialogOpen = false;
      scheduleRestoreFocus(restoreFocusability);
      if (!result || Object.keys(result).length === 0) {
        return;
      }
      try {
        await this.yomitanService.setDictionaryLanguages(result);
        this.toastService.success('Dictionary languages saved');
        // The switches of those dictionaries may have changed: show them
        this.reloadWebview();
      } catch (e) {
        console.error('[OfflineDictionaries] Failed to save the dictionary languages:', e);
        this.toastService.error('Could not save the dictionary languages');
      }
      await this.refreshDictionaryLanguages();
    });
  }

  private reloadWebview() {
    const wv = this.webview()?.nativeElement as Electron.WebviewTag | undefined;
    wv?.reload();
  }
}
