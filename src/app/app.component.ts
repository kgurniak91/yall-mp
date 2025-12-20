import {Component, inject, OnInit} from '@angular/core';
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

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Toast,
    ConfirmDialog,
    HeaderComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  private readonly fileOpenIntentService = inject(FileOpenIntentService);
  private readonly toastService = inject(ToastService);
  private readonly yomitanService = inject(YomitanService);

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
}
