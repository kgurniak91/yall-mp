import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild
} from '@angular/core';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {ActivatedRoute, NavigationEnd, NavigationStart, Router} from '@angular/router';
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

@Component({
  selector: 'app-header',
  imports: [
    Button,
    Menu,
    Tooltip
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly isProjectDetailsView = signal(false);
  protected readonly isMaximized = signal(false);
  protected readonly isFullScreen = signal(false);
  protected readonly isMenuOpen = signal(false);
  protected readonly currentProject = computed(() => this.computeCurrentProject());
  protected readonly mediaFileName = computed(() => this.currentProject()?.mediaFileName || 'Loading media...');
  protected readonly subtitleFileName = computed(() => this.currentProject()?.subtitleFileName || 'Loading subtitles...');
  protected readonly menuItems = computed<MenuItem[]>(() => this.computeMenuItems());
  protected readonly lastFilename = viewChild<ElementRef<HTMLDivElement>>('lastFilename');
  protected readonly menuWrapper = viewChild.required<ElementRef<HTMLDivElement>>('menuWrapper');
  protected readonly dragHandle = viewChild.required<ElementRef<HTMLDivElement>>('dragHandle');
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly headerCurrentProjectActionBridgeService = inject(HeaderCurrentProjectActionBridgeService);
  private resizeObserver: ResizeObserver | undefined;
  private resizeDebounceTimer: any;
  private cleanupMaximizedListener: (() => void) | null = null;
  private cleanupFullScreenListener: (() => void) | null = null;

  ngOnInit() {
    this.cleanupMaximizedListener = window.electronAPI.onWindowMaximizedStateChanged((isMaximized: boolean) => this.isMaximized.set(isMaximized));
    this.cleanupFullScreenListener = window.electronAPI.onWindowFullScreenStateChanged((isFullScreen: boolean) => this.isFullScreen.set(isFullScreen));

    this.router.events.pipe(
      filter((event): event is NavigationStart => event instanceof NavigationStart)
    ).subscribe(() => {
      // On navigation start, immediately apply a minimal, safe shape to prevent flicker
      this.updateDraggableShapes(true);
    });

    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(() => {
      let route = this.activatedRoute;
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
    this.resizeObserver = new ResizeObserver(() => {
      this.updateDraggableShapes();
    });
    this.resizeObserver.observe(this.menuWrapper().nativeElement);
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
  }

  private deleteProject(): void {
    const project = this.currentProject();
    if (project) {
      // TODO refactor duplicate code
      this.confirmationService.confirm({
        header: 'Confirm deletion',
        message: `Are you sure you want to delete the project <b>${project.mediaFileName}</b>?<br>This action cannot be undone.`,
        icon: 'fa-solid fa-circle-exclamation',
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
      return this.appStateService.lastOpenedProject();
    }
    return null;
  }

  private computeMenuItems(): MenuItem[] {
    const project = this.currentProject();

    const menu: MenuItem[] = [
      {
        label: 'Create new project',
        icon: 'fa-solid fa-plus',
        command: () => this.router.navigate(['/project/new'])
      },
      {
        label: 'List of projects',
        icon: 'fa-solid fa-list',
        command: () => this.router.navigate(['/projects'])
      }
    ];

    if (project) {
      menu.splice(1, 0, {
        label: 'Edit current project',
        icon: 'fa-solid fa-pencil',
        command: () => this.router.navigate(['/project/edit', project.id])
      });

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

    menu.push({
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
      });

    return menu;
  }

  private updateDraggableShapes(isMinimal: boolean = false) {
    clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = setTimeout(() => {
      const dragHandleEl = this.dragHandle().nativeElement;
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
