import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild
} from '@angular/core';
import type {MenuAction} from '../../../../electron-api';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {NavigationEnd, NavigationStart, Router} from '@angular/router';
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

// macOS title strip auto-hide (see onPointerMove).
const STRIP_HEIGHT_PX = 28; // MAC_TITLE_STRIP_HEIGHT in electron-main.ts
const STRIP_REVEAL_ZONE_PX = 4;
const STRIP_HIDE_DELAY_MS = 350;

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
export class HeaderComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly isProjectDetailsView = signal(false);
  protected readonly isMaximized = signal(false);
  protected readonly isFullScreen = signal(false);
  protected readonly isMenuOpen = signal(false);
  // On macOS the window is dragged through CSS drag regions (see header.component.scss);
  // elsewhere the main process punches the drag zones through the UI window instead.
  protected readonly usesCssDragRegions = window.electronAPI?.platform === 'darwin';
  /**
   * macOS native window chrome: the header is a title strip, the window buttons are the
   * system's, and the menu lives in the menu bar (see NATIVE_MAC_CHROME in electron-main.ts).
   */
  protected readonly nativeWindowChrome = window.electronAPI?.nativeWindowChrome === true;
  protected readonly windowTitle = computed(() =>
    this.isProjectDetailsView() ? (this.currentProject()?.mediaFileName || 'Loading media...') : "Y'ALL Media Player"
  );
  /** macOS: the title strip (and the traffic lights) show only while the pointer is at the top edge. */
  protected readonly stripVisible = signal(false);
  private stripHideTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stripPointerHandler = (event: MouseEvent) => this.onPointerMove(event.clientY);
  protected readonly currentUrl = signal<string>('');
  protected readonly currentProject = computed(() => this.computeCurrentProject());
  protected readonly mediaFileName = computed(() => this.currentProject()?.mediaFileName || 'Loading media...');
  protected readonly subtitleFileName = computed(() => this.currentProject()?.subtitleFileName || 'Loading subtitles...');
  protected readonly menuItems = computed<MenuItem[]>(() => this.computeMenuItems());
  protected readonly lastFilename = viewChild<ElementRef<HTMLDivElement>>('lastFilename');
  // Absent with the macOS native window chrome (see the template).
  protected readonly menuWrapper = viewChild<ElementRef<HTMLDivElement>>('menuWrapper');
  protected readonly dragHandle = viewChild<ElementRef<HTMLDivElement>>('dragHandle');
  private readonly router = inject(Router);
  private readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly headerCurrentProjectActionBridgeService = inject(HeaderCurrentProjectActionBridgeService);
  private resizeObserver: ResizeObserver | undefined;
  private resizeDebounceTimer: any;
  private cleanupMaximizedListener: (() => void) | null = null;
  private cleanupFullScreenListener: (() => void) | null = null;
  private cleanupMenuActionListener: (() => void) | null = null;

  constructor() {
    if (this.nativeWindowChrome) {
      document.documentElement.classList.add('native-window-chrome');
      effect(() => {
        // The strip is the title bar; in native full screen it goes away with the traffic lights.
        document.documentElement.classList.toggle('window-fullscreen', this.isFullScreen());
      });
      effect(() => {
        window.electronAPI.windowSetTitle(this.windowTitle());
      });
      effect(() => {
        window.electronAPI.windowSetButtonsVisible(this.stripVisible());
      });
      document.addEventListener('mousemove', this.stripPointerHandler);
    }
  }

  /** Reveal zone: the top few pixels of the window; hide once the pointer is clearly below the strip. */
  private onPointerMove(clientY: number): void {
    if (this.isFullScreen()) {
      return; // macOS shows its own menu bar on top-edge hover in full screen.
    }
    if (clientY <= STRIP_REVEAL_ZONE_PX) {
      this.showStrip();
    } else if (clientY > STRIP_HEIGHT_PX && this.stripVisible()) {
      this.hideStripSoon();
    }
  }

  protected onStripMouseLeave(): void {
    this.hideStripSoon();
  }

  private showStrip(): void {
    if (this.stripHideTimer !== undefined) {
      clearTimeout(this.stripHideTimer);
      this.stripHideTimer = undefined;
    }
    this.stripVisible.set(true);
  }

  private hideStripSoon(): void {
    if (this.stripHideTimer !== undefined) {
      return;
    }
    this.stripHideTimer = setTimeout(() => {
      this.stripHideTimer = undefined;
      this.stripVisible.set(false);
    }, STRIP_HIDE_DELAY_MS);
  }

  ngOnInit() {
    this.cleanupMaximizedListener = window.electronAPI.onWindowMaximizedStateChanged((isMaximized: boolean) => this.isMaximized.set(isMaximized));
    this.cleanupFullScreenListener = window.electronAPI.onWindowFullScreenStateChanged((isFullScreen: boolean) => this.isFullScreen.set(isFullScreen));
    if (this.nativeWindowChrome) {
      this.cleanupMenuActionListener = window.electronAPI.onMenuAction((action) => this.performMenuAction(action));
    }

    this.router.events.pipe(
      filter((event): event is NavigationStart => event instanceof NavigationStart)
    ).subscribe(() => {
      // On navigation start, immediately apply a minimal, safe shape to prevent flicker
      this.updateDraggableShapes(true);
    });

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
      // After navigation, wait a moment for the DOM to stabilize, then calculate the full shape
      setTimeout(() => this.updateDraggableShapes(), 100);
    });
  }

  ngAfterViewInit() {
    const menuWrapper = this.menuWrapper();
    if (!menuWrapper) {
      return; // macOS native window chrome: no drag zones to report.
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.updateDraggableShapes();
    });
    this.resizeObserver.observe(menuWrapper.nativeElement);
    this.updateDraggableShapes();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeDebounceTimer);
    if (this.cleanupMaximizedListener) {
      this.cleanupMaximizedListener();
    }
    if (this.cleanupFullScreenListener) {
      this.cleanupFullScreenListener();
    }
    if (this.cleanupMenuActionListener) {
      this.cleanupMenuActionListener();
    }
    document.removeEventListener('mousemove', this.stripPointerHandler);
    if (this.stripHideTimer !== undefined) {
      clearTimeout(this.stripHideTimer);
    }
  }

  /** The macOS menu bar's items do exactly what the header menu's items do. */
  private performMenuAction(action: MenuAction): void {
    const project = this.currentProject();
    switch (action) {
      case 'new-project':
        this.router.navigate(['/project/new']);
        break;
      case 'project-list':
        this.router.navigate(['/projects']);
        break;
      case 'edit-project':
        if (project) {
          this.router.navigate(['/project/edit', project.id]);
        }
        break;
      case 'delete-project':
        this.deleteProject();
        break;
      case 'previous-media':
        this.headerCurrentProjectActionBridgeService.goToPreviousMediaFile();
        break;
      case 'next-media':
        this.headerCurrentProjectActionBridgeService.goToNextMediaFile();
        break;
      case 'undo':
        this.headerCurrentProjectActionBridgeService.undo();
        break;
      case 'redo':
        this.headerCurrentProjectActionBridgeService.redo();
        break;
      case 'find-subtitles':
        this.headerCurrentProjectActionBridgeService.searchInSubtitles();
        break;
      case 'dictionary':
        this.headerCurrentProjectActionBridgeService.openDictionary();
        break;
      case 'transform-subtitles':
        this.headerCurrentProjectActionBridgeService.openSubtitleOffsetDialog();
        break;
      case 'settings':
        this.dialogOrchestrationService.openGlobalSettingsDialog();
        break;
      case 'help':
        this.dialogOrchestrationService.openHelpDialog();
        break;
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
            label: 'Search in dictionary (Ctrl+D)',
            icon: 'fa-solid fa-book',
            command: () => this.headerCurrentProjectActionBridgeService.openDictionary()
          },
          {
            label: 'Find in subtitles (Ctrl+F)',
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
        label: 'Undo (Ctrl+Z)',
        icon: 'fa-solid fa-rotate-left',
        command: () => this.headerCurrentProjectActionBridgeService.undo(),
        disabled: !this.headerCurrentProjectActionBridgeService.canUndo()
      }, {
        label: 'Redo (Ctrl+Y)',
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

  private updateDraggableShapes(isMinimal: boolean = false) {
    clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = setTimeout(() => {
      const dragHandleEl = this.dragHandle()?.nativeElement;
      if (!dragHandleEl) {
        return;
      }
      const dragHandleRect = dragHandleEl.getBoundingClientRect();

      // Start with the permanent drag handle, which is always present
      const shapes = [
        {
          x: Math.round(dragHandleRect.x),
          y: Math.round(dragHandleRect.y),
          width: Math.round(dragHandleRect.width),
          height: Math.round(dragHandleRect.height),
        }
      ];

      const lastFilenameEl = this.lastFilename()?.nativeElement;

      // In "full" mode, if the filename element exists, calculate the empty space and add it as a second draggable shape.
      if (!isMinimal && lastFilenameEl) {
        const lastFilenameRect = lastFilenameEl.getBoundingClientRect();
        const emptySpaceX = lastFilenameRect.right;
        const emptySpaceWidth = dragHandleRect.left - emptySpaceX;

        if (emptySpaceWidth > 0) {
          shapes.push({
            x: Math.round(emptySpaceX),
            y: Math.round(dragHandleRect.y),
            width: Math.round(emptySpaceWidth),
            height: Math.round(dragHandleRect.height),
          });
        }
      }

      window.electronAPI.windowUpdateDraggableZones(shapes);
    }, 50);
  }

}
