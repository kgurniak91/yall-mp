import {Component, inject} from '@angular/core';
import {AppStateService} from '../../state/app/app-state.service';
import {Router, RouterLink} from '@angular/router';
import {MinimalProject, Project} from '../../model/project.types';
import {Button} from 'primeng/button';
import {DataView} from 'primeng/dataview';
import {ConfirmationService} from 'primeng/api';
import {ProjectListItemComponent} from './project-list-item/project-list-item.component';
import {LogoComponent} from '../../shared/components/logo/logo.component';

@Component({
  selector: 'app-list-of-projects',
  imports: [
    Button,
    DataView,
    RouterLink,
    ProjectListItemComponent,
    LogoComponent
  ],
  templateUrl: './list-of-projects.component.html',
  styleUrl: './list-of-projects.component.scss'
})
export class ListOfProjectsComponent {
  protected readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly router = inject(Router);

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
      message: `Are you sure you want to delete the project <b>${project.mediaFileName}</b>?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => this.appStateService.deleteProject(project.id)
    });
  }
}
