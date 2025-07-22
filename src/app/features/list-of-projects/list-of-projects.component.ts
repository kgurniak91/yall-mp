import {Component, inject} from '@angular/core';
import {AppStateService} from '../../state/app/app-state.service';
import {Router, RouterLink} from '@angular/router';
import {Project} from '../../model/project.types';
import {Button} from 'primeng/button';
import {DataView} from 'primeng/dataview';
import {ConfirmationService} from 'primeng/api';
import {ProjectListItemComponent} from './project-list-item/project-list-item.component';

@Component({
  selector: 'app-list-of-projects',
  imports: [
    Button,
    DataView,
    RouterLink,
    ProjectListItemComponent
  ],
  templateUrl: './list-of-projects.component.html',
  styleUrl: './list-of-projects.component.scss'
})
export class ListOfProjectsComponent {
  protected readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly router = inject(Router);

  navigateToProject(project: Project): void {
    // TODO: Update the lastOpened time here before navigating
    // this.projectStateService.updateProject({...project, lastOpened: Date.now()});
    this.router.navigate(['/project', project.id]);
  }

  editProject(project: Project): void {
    this.router.navigate(['/project/edit', project.id]);
  }

  deleteProject(project: Project): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Are you sure you want to delete the project <b>${project.mediaFileName}</b>?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => this.appStateService.deleteProject(project.id)
    });
  }
}
