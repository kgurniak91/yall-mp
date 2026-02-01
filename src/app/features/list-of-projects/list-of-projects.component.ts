import {ChangeDetectionStrategy, Component, computed, inject, OnDestroy} from '@angular/core';
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
  protected filteredProjects = computed(() => {
    const activeId = this.activeCatalogId();
    return this.appStateService.projects().filter(p => p.catalogId === activeId);
  });
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

  editProject(project: MinimalProject): void {
    this.router.navigate(['/project/edit', project.id]);
  }

  deleteProject(project: MinimalProject): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Delete project <b>${project.mediaFileName}</b>?`,
      icon: 'fa-solid fa-circle-exclamation',
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
