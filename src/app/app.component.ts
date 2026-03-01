import {ChangeDetectionStrategy, Component, HostListener, inject, OnInit} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {Toast} from 'primeng/toast';
import {ConfirmDialog} from 'primeng/confirmdialog';
import {HeaderComponent} from './core/layout/header/header.component';
import {
  GlobalKeyboardShortcutsService
} from './core/services/global-keyboard-shortcuts/global-keyboard-shortcuts.service';
import {FileOpenIntentService} from './core/services/file-open-intent/file-open-intent.service';
import {ToastService} from './shared/services/toast/toast.service';
import {YomitanService} from './core/services/yomitan/yomitan.service';
import {ProgressBar} from 'primeng/progressbar';
import {PrimeTemplate} from 'primeng/api';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Toast,
    ConfirmDialog,
    HeaderComponent,
    ProgressBar,
    PrimeTemplate
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit {
  protected readonly toastService = inject(ToastService);
  private readonly fileOpenIntentService = inject(FileOpenIntentService);
  private readonly yomitanService = inject(YomitanService);
  private isResizing = false;

  constructor() {
    inject(GlobalKeyboardShortcutsService);
  }

  ngOnInit() {
    // Listen for files passed while app is ALREADY running
    window.electronAPI.onAppOpenFiles(async (filePaths) => {
      const error = await this.fileOpenIntentService.processFiles(filePaths);
      if (error) {
        this.toastService.error(error);
      }
    });

    this.yomitanService.ensureLanguagesLoaded();
  }

  protected onResizeStart(event: MouseEvent, direction: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    window.electronAPI.windowStartManualResize(direction);
  }

  @HostListener('window:mouseup')
  protected onGlobalMouseUp(): void {
    if (this.isResizing) {
      window.electronAPI.windowStopManualResize();
      this.isResizing = false;
    }
  }
}
