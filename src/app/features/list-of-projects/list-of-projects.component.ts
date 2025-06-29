import {Component, inject} from '@angular/core';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Router, RouterLink} from '@angular/router';
import {Project} from '../../model/project.types';
import {Button} from 'primeng/button';
import {DataView} from 'primeng/dataview';
import {PrimeTemplate} from 'primeng/api';
import {ProjectListItemComponent} from './project-list-item/project-list-item.component';

@Component({
  selector: 'app-list-of-projects',
  imports: [
    Button,
    DataView,
    RouterLink,
    PrimeTemplate,
    ProjectListItemComponent
  ],
  templateUrl: './list-of-projects.component.html',
  styleUrl: './list-of-projects.component.scss'
})
export class ListOfProjectsComponent {
  private readonly router = inject(Router);
  protected readonly projectsStateService = inject(ProjectsStateService);

  navigateToProject(project: Project): void {
    // TODO: Update the lastOpened time here before navigating
    // this.projectStateService.updateProject({...project, lastOpened: Date.now()});
    this.router.navigate(['/project', project.id]);
  }

  editProject(project: Project): void {
    console.log('Editing project:', project.id);
    // TODO open a modal to replace files
  }

  deleteProject(project: Project): void {
    console.log('Deleting project:', project.id);
    // TODO confirm and then call projectStateService.deleteProject
  }
}
