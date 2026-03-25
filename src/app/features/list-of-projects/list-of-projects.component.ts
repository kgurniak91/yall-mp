import {ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal} from '@angular/core';
import {AppStateService} from '../../state/app/app-state.service';
import {Router, RouterLink} from '@angular/router';
import {MinimalProject} from '../../model/project.types';
import {Button} from 'primeng/button';
import {DataView} from 'primeng/dataview';
import {ConfirmationService} from 'primeng/api';
import {ProjectListItemComponent} from './project-list-item/project-list-item.component';
import {SplitterModule} from 'primeng/splitter';
import {FormsModule} from '@angular/forms';
import {DragDropModule} from 'primeng/dragdrop';
import {ToastService} from '../../shared/services/toast/toast.service';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {DialogService, DynamicDialogRef} from 'primeng/dynamicdialog';
import {MoveProjectDialogComponent} from './move-project-dialog/move-project-dialog.component';
import {CatalogsTreeComponent} from './catalogs-tree/catalogs-tree.component';
import {CatalogsBreadcrumbComponent} from './catalogs-breadcrumb/catalogs-breadcrumb.component';
import {MoveProjectDialogData} from './move-project-dialog/move-project-dialog.types';
import {take} from 'rxjs';
import {DEFAULT_CONFIRMATION} from '../../shared/types/confirmation.types';

@Component({
  selector: 'app-list-of-projects',
  imports: [
    Button,
    DataView,
    RouterLink,
    ProjectListItemComponent,
    SplitterModule,
    FormsModule,
    DragDropModule,
    CatalogsTreeComponent,
    CatalogsBreadcrumbComponent
  ],
  templateUrl: './list-of-projects.component.html',
  styleUrl: './list-of-projects.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListOfProjectsComponent implements OnDestroy {
  protected readonly appStateService = inject(AppStateService);
  protected activeCatalogId = computed(() => this.appStateService.activeCatalogId());
  protected activeCatalogProjects = computed(() => {
    const activeId = this.activeCatalogId();
    return this.appStateService.projects().filter(p => p.catalogId === activeId);
  });
  protected readonly areAllSelected = computed(() => {
    const projects = this.activeCatalogProjects();
    if (projects.length === 0) {
      return false;
    }
    const currentSelection = this.selectedProjectIds();
    return projects.every(p => currentSelection.has(p.id));
  });
  protected readonly selectionMode = signal(false);
  protected readonly selectedProjectIds = signal<Set<string>>(new Set());
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private activeDialogRef: DynamicDialogRef | null = null;

  ngOnDestroy(): void {
    this.activeDialogRef?.close();
  }

  protected onBreadcrumbSelect(catalogId: string): void {
    this.appStateService.setActiveCatalog(catalogId);
  }

  async navigateToProject(project: MinimalProject): Promise<void> {
    await this.appStateService.setCurrentProject(project.id);
    this.router.navigate(['/project', project.id]);
  }

  toggleSelectionMode() {
    this.selectionMode.update(v => !v);
    this.selectedProjectIds.set(new Set());
  }

  onToggleProjectSelection(id: string) {
    this.selectedProjectIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }

  toggleSelectAll() {
    const filtered = this.activeCatalogProjects();
    const currentSet = this.selectedProjectIds();
    const newSet = new Set(currentSet);

    if (this.areAllSelected()) {
      filtered.forEach(p => newSet.delete(p.id));
    } else {
      filtered.forEach(p => newSet.add(p.id));
    }

    this.selectedProjectIds.set(newSet);
  }

  deleteSelected() {
    const ids = Array.from(this.selectedProjectIds());
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Confirm Bulk Deletion',
      message: `Are you sure you want to delete <b>${ids.length}</b> selected projects?`,
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.appStateService.deleteProjects(ids);
        this.selectedProjectIds.set(new Set());
        this.selectionMode.set(false);
        this.toastService.success(`${ids.length} projects deleted`);
      }
    });
  }

  moveSelected() {
    const ids = Array.from(this.selectedProjectIds());
    if (ids.length === 0) {
      return;
    }

    const restoreFocus = disableFocusInParentDialog();

    const data: MoveProjectDialogData = {
      currentCatalogId: this.activeCatalogId()
    };

    this.activeDialogRef = this.dialogService.open(MoveProjectDialogComponent, {
      header: `Move ${ids.length} Projects`,
      width: 'clamp(20rem, 95vw, 45rem)',
      modal: true,
      data
    });

    this.activeDialogRef.onClose.pipe(take(1)).subscribe((newCatalogId: string | undefined) => {
      this.activeDialogRef = null;
      scheduleRestoreFocus(restoreFocus);

      if (newCatalogId === undefined) {
        return;
      }

      if (newCatalogId !== this.activeCatalogId()) {
        this.appStateService.moveProjectsToCatalog(ids, newCatalogId);
        this.selectedProjectIds.set(new Set());
        this.selectionMode.set(false);
        this.toastService.success(`${ids.length} projects moved`);
      }
    });
  }

  editProject(project: MinimalProject): void {
    this.router.navigate(['/project/edit', project.id]);
  }

  deleteProject(project: MinimalProject): void {
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Confirm deletion',
      message: `Delete project <b>${project.mediaFileName}</b>?`,
      accept: () => this.appStateService.deleteProject(project.id)
    });
  }

  openMoveProjectDialog(project: MinimalProject) {
    const restoreFocus = disableFocusInParentDialog();

    const data: MoveProjectDialogData = {
      currentCatalogId: project.catalogId
    };

    this.activeDialogRef = this.dialogService.open(MoveProjectDialogComponent, {
      header: 'Move Project',
      width: 'clamp(20rem, 95vw, 45rem)',
      modal: true,
      data
    });

    this.activeDialogRef.onClose.pipe(take(1)).subscribe((newCatalogId: string | undefined) => {
      this.activeDialogRef = null;
      scheduleRestoreFocus(restoreFocus);

      if (newCatalogId === undefined) {
        return;
      }

      if (newCatalogId !== project.catalogId) {
        this.appStateService.moveProjectToCatalog(project.id, newCatalogId);
        this.toastService.success('Project moved');
      }
    });
  }
}
