import {
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

@Component({
  selector: 'app-yomitan-popup',
  schemas: [
    NO_ERRORS_SCHEMA // Needed for <webview> from Electron
  ],
  templateUrl: './yomitan-popup.component.html',
  styleUrls: ['./yomitan-popup.component.scss']
})
export class YomitanPopupComponent implements OnInit, OnDestroy {
  public readonly searchText = input.required<string>();
  public readonly addToNotes = output<string>();
  public readonly close = output<void>();
  protected readonly searchUrl = signal<string | null>(null);
  protected readonly canGoBack = signal(false);
  protected readonly canGoForward = signal(false);
  private readonly webviewRef = viewChild('wv', {read: ElementRef});
  private readonly yomitanService = inject(YomitanService);

  async ngOnInit() {
    const text = this.searchText();
    if (!text) {
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
    const wv = this.webviewRef()?.nativeElement;
    if (wv) {
      wv.removeEventListener('console-message', this.handleConsoleMessage);
      wv.removeEventListener('context-menu', this.handleContextMenu);
      wv.removeEventListener('new-window', this.handleNewWindow);
      wv.removeEventListener('will-navigate', this.handleWillNavigate);
      wv.removeEventListener('did-navigate', this.updateNavState);
      wv.removeEventListener('did-navigate-in-page', this.updateNavState);
    }
  }

  onDomReady() {
    const wv = this.webviewRef()!.nativeElement as Electron.WebviewTag;

    wv.insertCSS(`
      #search-header, .search-header { display: none !important; }
      #navigation-header { display: none !important; }
      body {
        padding: 0 !important;
        margin: 0 !important;
        background-color: white !important;
        overflow-y: auto;
      }
      #content-body { padding: 10px !important; }
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
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          const selection = window.getSelection().toString();
          if (selection) {
             console.log('YALL_SHORTCUT_ADD_NOTE:' + selection);
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
    if (e.message.startsWith('YALL_SHORTCUT_ADD_NOTE:')) {
      const selection = e.message.substring('YALL_SHORTCUT_ADD_NOTE:'.length);
      if (selection) {
        this.addToNotes.emit(selection);
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
      const action = await window.electronAPI.showContextMenu({text: params.selectionText});
      if (action === 'add-to-notes') {
        this.addToNotes.emit(params.selectionText);
      }
    }
  };

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
}
