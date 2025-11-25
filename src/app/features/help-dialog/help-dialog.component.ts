import {Component, inject, OnInit, signal} from '@angular/core';
import {TableModule} from 'primeng/table';
import {Tag} from 'primeng/tag';
import {Fieldset} from 'primeng/fieldset';
import {Button} from 'primeng/button';
import {KeyboardShortcutGroup} from '../../model/keyboard-shortcuts.types';
import {
  KeyboardShortcutsHelperService
} from '../../core/services/keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {LogoComponent} from '../../shared/components/logo/logo.component';
import {Tooltip} from 'primeng/tooltip';

@Component({
  selector: 'app-help-dialog',
  imports: [
    TableModule,
    Tag,
    Fieldset,
    Button,
    LogoComponent,
    Tooltip
  ],
  templateUrl: './help-dialog.component.html',
  styleUrl: './help-dialog.component.scss',
})
export class HelpDialogComponent implements OnInit {
  protected readonly appVersion = signal('...');
  protected readonly shortcutGroups: { name: KeyboardShortcutGroup; shortcuts: any[] }[];
  private readonly keyboardShortcutsHelperService = inject(KeyboardShortcutsHelperService);

  constructor() {
    this.shortcutGroups = this.keyboardShortcutsHelperService.getGroupedShortcuts();
  }

  ngOnInit(): void {
    window.electronAPI.getAppVersion().then(version => {
      this.appVersion.set(version);
    });
  }

  protected onExternalLinkClick(url: string, event: MouseEvent): void {
    event.preventDefault();
    window.electronAPI.openInSystemBrowser(url);
  }
}
