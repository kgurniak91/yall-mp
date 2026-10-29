import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {NavigationEnd, Router} from '@angular/router';
import {AppStateService} from '../../../state/app/app-state.service';
import {filter} from 'rxjs';
import {Project} from '../../../model/project.types';
import {Button} from 'primeng/button';
import {Menu} from 'primeng/menu';
import {Tooltip} from 'primeng/tooltip';
import {DialogOrchestrationService} from '../../services/dialog-orchestration/dialog-orchestration.service';
import {
  HeaderCurrentProjectActionBridgeService
} from '../../services/header-current-project-action-bridge/header-current-project-action-bridge.service';
import {LogoComponent} from '../../../shared/components/logo/logo.component';
import {DEFAULT_CONFIRMATION} from '../../../shared/types/confirmation.types';
import {localizeModifier} from '../../services/keyboard-shortcuts-helper/primary-modifier';

@Component({
  selector: 'app-header',
  imports: [
    Button,
    Menu,
    Tooltip,
    LogoComponent
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent implements OnInit, OnDestroy {
  protected readonly isProjectDetailsView = signal(false);
  protected readonly isMaximized = signal(false);
  protected readonly isFullScreen = signal(false);
  protected readonly isMenuOpen = signal(false);
  protected readonly currentUrl = signal<string>('');
  protected readonly currentProject = computed(() => this.computeCurrentProject());
  protected readonly mediaFileName = computed(() => this.currentProject()?.mediaFileName || 'Loading media...');
  protected readonly subtitleFileName = computed(() => this.currentProject()?.subtitleFileName || 'Loading subtitles...');
  protected readonly menuItems = computed<MenuItem[]>(() => this.computeMenuItems());
  private readonly router = inject(Router);
  private readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly headerCurrentProjectActionBridgeService = inject(HeaderCurrentProjectActionBridgeService);
  private cleanupMaximizedListener: (() => void) | null = null;
  private cleanupFullScreenListener: (() => void) | null = null;

  ngOnInit() {
    this.cleanupMaximizedListener = window.electronAPI.onWindowMaximizedStateChanged((isMaximized: boolean) => this.isMaximized.set(isMaximized));
    this.cleanupFullScreenListener = window.electronAPI.onWindowFullScreenStateChanged((isFullScreen: boolean) => this.isFullScreen.set(isFullScreen));

    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.currentUrl.set(event.urlAfterRedirects || event.url);
      let route = this.router.routerState.root;
      while (route.firstChild) {
        route = route.firstChild;
      }
      const isDetailsView = route.snapshot.routeConfig?.path === 'project/:id';
      this.isProjectDetailsView.set(isDetailsView);
    });
  }

  ngOnDestroy() {
    if (this.cleanupMaximizedListener) {
      this.cleanupMaximizedListener();
    }
    if (this.cleanupFullScreenListener) {
      this.cleanupFullScreenListener();
    }
  }

  private deleteProject(): void {
    const project = this.currentProject();
    if (project) {
      this.confirmationService.confirm({
        ...DEFAULT_CONFIRMATION,
        header: 'Confirm deletion',
        message: `Are you sure you want to delete the project <b>${project.mediaFileName}</b>?<br>This action cannot be undone.`,
        accept: () => {
          this.appStateService.deleteProject(project.id);
          this.router.navigate(['/projects']);
        }
      });
    }
  }

  protected onMinimizeClicked(): void {
    window.electronAPI.windowMinimize();
  }

  protected onToggleMaximizeClicked(): void {
    if (this.isFullScreen()) {
      window.electronAPI.windowToggleFullScreen();
    } else {
      window.electronAPI.windowToggleMaximize();
    }
  }

  protected onToggleFullScreenClicked(): void {
    window.electronAPI.windowToggleFullScreen();
  }

  protected onCloseClicked(): void {
    window.electronAPI.windowClose();
  }

  private computeCurrentProject(): Project | null {
    if (this.isProjectDetailsView()) {
      return this.appStateService.currentProject();
    }
    return null;
  }

  private computeMenuItems(): MenuItem[] {
    const project = this.currentProject();
    const url = this.currentUrl();
    const menu: MenuItem[] = [];

    if (!url.includes('/project/new')) {
      menu.push({
        label: 'Create new project',
        icon: 'fa-solid fa-plus',
        command: () => this.router.navigate(['/project/new'])
      });
    }

    if (url !== '/projects') {
      menu.push({
        label: 'List of projects',
        icon: 'fa-solid fa-list',
        command: () => this.router.navigate(['/projects'])
      });
    }

    if (project) {
      menu.splice(1, 0, {
        label: 'Edit current project',
        icon: 'fa-solid fa-pencil',
        command: () => this.router.navigate(['/project/edit', project.id])
      });

      if (this.isProjectDetailsView()) {
        menu.push(
          {
            separator: true
          },
          {
            label: localizeModifier('Search in dictionary (Ctrl+D)'),
            icon: 'fa-solid fa-book',
            command: () => this.headerCurrentProjectActionBridgeService.openDictionary()
          },
          {
            label: localizeModifier('Find in subtitles (Ctrl+F)'),
            icon: 'fa-solid fa-magnifying-glass',
            command: () => this.headerCurrentProjectActionBridgeService.searchInSubtitles()
          },
          {
            label: 'Transform all subtitles',
            icon: 'fa-solid fa-clock-rotate-left',
            command: () => this.headerCurrentProjectActionBridgeService.openSubtitleOffsetDialog()
          },
          {
            separator: true
          },
          {
            label: 'Previous media file',
            icon: 'fa-solid fa-backward-step',
            disabled: !this.headerCurrentProjectActionBridgeService.canGoToPrevMedia(),
            command: () => this.headerCurrentProjectActionBridgeService.goToPreviousMediaFile()
          },
          {
            label: 'Next media file',
            icon: 'fa-solid fa-forward-step',
            disabled: !this.headerCurrentProjectActionBridgeService.canGoToNextMedia(),
            command: () => this.headerCurrentProjectActionBridgeService.goToNextMediaFile()
          }
        );
      }

      menu.push({
        separator: true
      }, {
        label: localizeModifier('Undo (Ctrl+Z)'),
        icon: 'fa-solid fa-rotate-left',
        command: () => this.headerCurrentProjectActionBridgeService.undo(),
        disabled: !this.headerCurrentProjectActionBridgeService.canUndo()
      }, {
        label: localizeModifier('Redo (Ctrl+Y)'),
        icon: 'fa-solid fa-rotate-right',
        command: () => this.headerCurrentProjectActionBridgeService.redo(),
        disabled: !this.headerCurrentProjectActionBridgeService.canRedo()
      });

      menu.push({
        separator: true
      }, {
        label: 'Delete current project',
        icon: 'fa-solid fa-trash',
        command: () => this.deleteProject(),
        styleClass: 'p-menuitem-danger'
      });
    }

    menu.push(
      {
        separator: true
      },
      {
        label: 'Global settings (O)',
        icon: 'fa-solid fa-gear',
        command: () => this.dialogOrchestrationService.openGlobalSettingsDialog()
      },
      {
        label: 'Help & About (F1)',
        icon: 'fa-solid fa-circle-question',
        command: () => this.dialogOrchestrationService.openHelpDialog()
      },
      {
        separator: true
      },
      {
        label: 'Exit (Alt+F4)',
        icon: 'fa-solid fa-power-off',
        command: () => this.onCloseClicked()
      },
    );

    return menu;
  }

}
