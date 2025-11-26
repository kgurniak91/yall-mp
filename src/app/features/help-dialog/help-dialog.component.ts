import {Component, inject, OnInit, signal} from '@angular/core';
import {TableModule} from 'primeng/table';
import {Tag} from 'primeng/tag';
import {Button} from 'primeng/button';
import {KeyboardShortcutGroup} from '../../model/keyboard-shortcuts.types';
import {
  KeyboardShortcutsHelperService
} from '../../core/services/keyboard-shortcuts-helper/keyboard-shortcuts-helper.service';
import {LogoComponent} from '../../shared/components/logo/logo.component';
import {Tooltip} from 'primeng/tooltip';
import {Tab, TabList, TabPanel, TabPanels, Tabs} from 'primeng/tabs';
import {HelpDialogTab, OpenSourceLicense} from './help-dialog.types';
import {HttpClient} from '@angular/common/http';
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel} from 'primeng/accordion';
import {ScrollPanel} from 'primeng/scrollpanel';

@Component({
  selector: 'app-help-dialog',
  imports: [
    TableModule,
    Tag,
    Button,
    LogoComponent,
    Tooltip,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    Tabs,
    AccordionContent,
    AccordionPanel,
    Accordion,
    AccordionHeader,
    ScrollPanel
  ],
  templateUrl: './help-dialog.component.html',
  styleUrl: './help-dialog.component.scss',
})
export class HelpDialogComponent implements OnInit {
  protected readonly selectedTabIndex = signal(HelpDialogTab.About);
  protected readonly appVersion = signal('...');
  protected readonly licenses = signal<OpenSourceLicense[]>([]);
  protected readonly openedLicenses = signal<string[]>([]);
  protected readonly shortcutGroups: { name: KeyboardShortcutGroup; shortcuts: any[] }[];
  protected readonly HelpDialogTab = HelpDialogTab;
  private readonly keyboardShortcutsHelperService = inject(KeyboardShortcutsHelperService);
  private readonly http = inject(HttpClient);

  constructor() {
    this.shortcutGroups = this.keyboardShortcutsHelperService.getGroupedShortcuts();
  }

  ngOnInit(): void {
    window.electronAPI.getAppVersion().then(version => {
      this.appVersion.set(version);
    });

    this.http.get<OpenSourceLicense[]>('licenses.json').subscribe({
      next: (data) => this.licenses.set(data),
      error: (err) => console.warn('Could not load licenses.json', err)
    });
  }

  formatLicense(license: string | string[]): string {
    if (Array.isArray(license)) {
      return license.join(', ');
    }
    return license || 'Unknown';
  }

  protected onExternalLinkClick(url: string | undefined, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (url) {
      window.electronAPI.openInSystemBrowser(url);
    }
  }
}
