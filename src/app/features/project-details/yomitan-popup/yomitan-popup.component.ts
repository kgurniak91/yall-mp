import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  NO_ERRORS_SCHEMA,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild
} from '@angular/core';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';
import {ToastService} from '../../../shared/services/toast/toast.service';

@Component({
  selector: 'app-yomitan-popup',
  schemas: [
    NO_ERRORS_SCHEMA // Needed for <webview> from Electron
  ],
  templateUrl: './yomitan-popup.component.html',
  styleUrls: ['./yomitan-popup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class YomitanPopupComponent implements OnInit, OnDestroy {
  public readonly searchText = input.required<string>();
  public readonly allowNotes = input<boolean>(true);
  public readonly addToNotes = output<{term: string, text: string}>();
  public readonly close = output<void>();
  protected readonly searchUrl = signal<string | null>(null);
  protected readonly canGoBack = signal(false);
  protected readonly canGoForward = signal(false);
  private readonly webviewRef = viewChild('wv', {read: ElementRef});
  private readonly yomitanService = inject(YomitanService);
  private readonly toastService = inject(ToastService);

  async ngOnInit() {
    const text = this.searchText();
    if (text == null) {
      return;
    }

    const extId = await this.yomitanService.getExtensionId();

    if (!extId) {
      console.error('Yomitan Extension ID not found.');
      return;
    }

    const encoded = encodeURIComponent(text);
    this.searchUrl.set(`chrome-extension://${extId}/search.html?query=${encoded}&type=terms&full-visible=true`);
  }

  ngOnDestroy() {
    this.removeListeners();
  }

  onDomReady() {
    const wv = this.webviewRef()!.nativeElement as Electron.WebviewTag;
    const isManualMode = this.searchText() === '';

    if (isManualMode) {
      wv.focus();
    }

    this.removeListeners();

    wv.insertCSS(`
      #navigation-header,
      #intro,
      .search-options,
      #query-parser-container {
        display: none !important;
      }

      body {
        padding: 0 !important;
        margin: 0 !important;
        background-color: white !important;
        overflow-y: auto;
      }

      #content-body { padding: 10px !important; }

      summary, span.tag, span[data-sc-content="tag"] {
        user-select: none !important;
        cursor: pointer;
      }
    `);

    // Auto-focus input field if available
    wv.executeJavaScript(`
      setTimeout(() => {
        const input = document.getElementById('search-textbox');
        if (input) {
          ${isManualMode ? 'input.focus();' : ''}
        }
      }, 100);
    `);

    wv.executeJavaScript(`
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href && !link.href.startsWith('chrome-extension://') && !link.href.startsWith('javascript:')) {
          e.preventDefault(); e.stopPropagation();
          window.open(link.href, '_blank');
        }
      }, true);
    `);

    wv.executeJavaScript(`
       document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();

          const selection = window.getSelection();
          let text = '';

          if (selection.rangeCount > 0) {
             const range = selection.getRangeAt(0);
             const fragment = range.cloneContents();

             // Create a temporary container to manipulate the selection
             const div = document.createElement('div');
             div.appendChild(fragment);

             // Remove specific summary header elements (e.g., "3 examples", "Etymology")
             div.querySelectorAll('summary').forEach(el => el.remove());

             // Remove tags (e.g., "adj", "US", dictionary names)
             div.querySelectorAll('span.tag').forEach(el => el.remove());
             div.querySelectorAll('span[data-sc-content="tag"]').forEach(el => el.remove());

             // Attach the temporary container to the DOM offscreen for a moment to ensure correct newlines for block elements (like <li> or <p>)
             div.style.position = 'fixed';
             div.style.left = '-9999px';
             div.style.top = '0';
             div.style.opacity = '0';
             div.style.pointerEvents = 'none';
             div.style.whiteSpace = 'pre-wrap';
             div.tabIndex = -1;
             document.body.appendChild(div);

             text = div.innerText;

             document.body.removeChild(div);
          }

          if (text) {
             const currentTerm = document.getElementById('search-textbox')?.value || '';
             console.log('YALL_ADD_NOTE_JSON:' + JSON.stringify({ term: currentTerm, text: text }));
          }
        }
      });
    `);

    wv.executeJavaScript(`
       document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
           e.preventDefault();
           console.log('YALL_CLOSE_POPUP');
        }
      });
    `);

    wv.addEventListener('console-message', this.handleConsoleMessage);
    wv.addEventListener('context-menu', this.handleContextMenu);
    wv.addEventListener('new-window', this.handleNewWindow);
    wv.addEventListener('will-navigate', this.handleWillNavigate);
    wv.addEventListener('did-navigate', this.updateNavState);
    wv.addEventListener('did-navigate-in-page', this.updateNavState);

    this.updateNavState();
  }

  protected goBack(): void {
    const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
    if (wv?.canGoBack()) {
      wv.goBack();
    }
  }

  protected goForward(): void {
    const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
    if (wv?.canGoForward()) {
      wv.goForward();
    }
  }

  private updateNavState = () => {
    const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
    if (wv) {
      this.canGoBack.set(wv.canGoBack());
      this.canGoForward.set(wv.canGoForward());
    }
  };

  private handleConsoleMessage = (e: { message: string }) => {
    if (e.message.startsWith('YALL_ADD_NOTE_JSON:')) {
      if (this.allowNotes()) {
        try {
          const data = JSON.parse(e.message.substring('YALL_ADD_NOTE_JSON:'.length));
          if (data.text) {
            this.addToNotes.emit({ term: data.term.trim(), text: data.text });
          }
        } catch (err) {
          console.error('Failed to parse note data from webview', err);
        }
      } else {
        this.toastService.info('Cannot add notes while in a gap');
      }
    }

    if (e.message === 'YALL_CLOSE_POPUP') {
      this.close.emit();
      return;
    }
  };

  private handleContextMenu = async (e: any) => {
    const params = e.params as Electron.ContextMenuParams;
    if (params.selectionText) {
      const action = await window.electronAPI.showContextMenu({
        text: params.selectionText,
        allowNotes: this.allowNotes()
      });

      if (action === 'add-to-notes') {
        const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
        let currentTerm = '';
        if (wv) {
          currentTerm = await wv.executeJavaScript("document.getElementById('search-textbox')?.value || ''");
        }
        this.addToNotes.emit({ term: currentTerm.trim(), text: params.selectionText });
      } else if (action === 'search-in-dictionary') {
        this.searchInDictionary(params.selectionText);
      }
    }
  };

  private async searchInDictionary(text: string) {
    const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
    const extId = await this.yomitanService.getExtensionId();
    if (wv && extId) {
      const encoded = encodeURIComponent(text);
      const newUrl = `chrome-extension://${extId}/search.html?query=${encoded}&type=terms&full-visible=true`;
      wv.loadURL(newUrl);
    }
  }

  private handleNewWindow = (e: any) => {
    e.preventDefault();
    if (e.url) window.electronAPI.openInSystemBrowser(e.url);
  };

  private handleWillNavigate = (e: any) => {
    if (e.url && !e.url.startsWith('chrome-extension://')) {
      e.preventDefault();
      window.electronAPI.openInSystemBrowser(e.url);
    }
  };

  private removeListeners() {
    const wv = this.webviewRef()?.nativeElement as Electron.WebviewTag;
    if (wv) {
      wv.removeEventListener('console-message', this.handleConsoleMessage);
      wv.removeEventListener('context-menu', this.handleContextMenu);
      wv.removeEventListener('new-window', this.handleNewWindow);
      wv.removeEventListener('will-navigate', this.handleWillNavigate);
      wv.removeEventListener('did-navigate', this.updateNavState);
      wv.removeEventListener('did-navigate-in-page', this.updateNavState);
    }
  }
}
