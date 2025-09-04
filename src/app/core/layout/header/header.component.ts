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
import {ActivatedRoute, NavigationEnd, Router} from '@angular/router';
import {AppStateService} from '../../../state/app/app-state.service';
import {filter} from 'rxjs';
import {DialogService} from 'primeng/dynamicdialog';
import {GlobalSettingsDialogComponent} from '../../../features/global-settings-dialog/global-settings-dialog.component';
import {Project} from '../../../model/project.types';
import {Button} from 'primeng/button';
import {Menu} from 'primeng/menu';
import {Tooltip} from 'primeng/tooltip';

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
  private readonly dialogService = inject(DialogService);
  private resizeObserver: ResizeObserver | undefined;
  private resizeDebounceTimer: any;

  ngOnInit() {
    window.electronAPI.onWindowMaximizedStateChanged((isMaximized: boolean) => this.isMaximized.set(isMaximized));
    window.electronAPI.onWindowFullScreenStateChanged((isFullScreen: boolean) => this.isFullScreen.set(isFullScreen));

    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(() => {
      let route = this.activatedRoute;
      while (route.firstChild) {
        route = route.firstChild;
      }
      const isDetailsView = route.snapshot.routeConfig?.path === 'project/:id';
      this.isProjectDetailsView.set(isDetailsView);
    });
  }

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateDraggableShapes();
    });
    this.resizeObserver.observe(this.menuWrapper().nativeElement);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeDebounceTimer);
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

  private openGlobalSettings(): void {
    this.dialogService.open(GlobalSettingsDialogComponent, {
      header: 'Global settings',
      width: 'clamp(20rem, 95vw, 60rem)',
      focusOnShow: false,
      closable: true,
      modal: true
    });
  }

  protected onMinimizeClicked(): void {
    window.electronAPI.windowMinimize();
  }

  protected onToggleMaximizeClicked(): void {
    window.electronAPI.windowToggleMaximize();
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
        label: 'Global settings',
        icon: 'fa-solid fa-gear',
        command: () => this.openGlobalSettings()
      },
      {
        label: 'Help & Shortcuts',
        icon: 'fa-solid fa-circle-question',
        command: () => {
          /* TODO */
        }
      });

    return menu;
  }

  private updateDraggableShapes() {
    clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = setTimeout(() => {
      const lastFilenameEl = this.lastFilename()?.nativeElement;
      const dragHandleEl = this.dragHandle().nativeElement;

      // If the last filename div isn't rendered yet, only send the permanent drag handle's shape.
      if (!lastFilenameEl) {
        const dragHandleRect = dragHandleEl.getBoundingClientRect();
        window.electronAPI.windowUpdateDraggableZones([
          {
            x: Math.round(dragHandleRect.x),
            y: Math.round(dragHandleRect.y),
            width: Math.round(dragHandleRect.width),
            height: Math.round(dragHandleRect.height),
          }
        ]);
        return;
      }

      
      const lastFilenameRect = lastFilenameEl.getBoundingClientRect();
      const dragHandleRect = dragHandleEl.getBoundingClientRect();

      // Calculate the dimensions of the empty space
      const emptySpaceX = lastFilenameRect.right;
      const emptySpaceWidth = dragHandleRect.left - emptySpaceX;

      const shapes = [];

      // Shape 1: The permanent, last-resort drag handle
      shapes.push({
        x: Math.round(dragHandleRect.x),
        y: Math.round(dragHandleRect.y),
        width: Math.round(dragHandleRect.width),
        height: Math.round(dragHandleRect.height),
      });

      // Shape 2: The dynamic empty space (only if it's wide enough to be useful)
      if (emptySpaceWidth > 0) {
        shapes.push({
          x: Math.round(emptySpaceX),
          y: Math.round(dragHandleRect.y),
          width: Math.round(emptySpaceWidth),
          height: Math.round(dragHandleRect.height),
        });
      }

      window.electronAPI.windowUpdateDraggableZones(shapes);
    }, 50);
  }

}
