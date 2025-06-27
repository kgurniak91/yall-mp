import {Routes} from '@angular/router';
import {inject} from '@angular/core';
import {ProjectsStateService} from './state/projects/projects-state.service';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => {
      const projectStateService = inject(ProjectsStateService);
      const lastProject = projectStateService.lastOpenedProject();
      return lastProject ? `/project/${lastProject.id}` : '/new-project';
    }
  },
  {
    path: 'new-project',
    loadComponent: () => import('./features/new-project/new-project.component').then(m => m.NewProjectComponent)
  },
  {
    path: 'projects',
    loadComponent: () => import('./features/list-of-projects/list-of-projects.component').then(m => m.ListOfProjectsComponent)
  },
  {
    path: 'project/:id',
    loadComponent: () => import('./features/project-details/project-details.component').then(m => m.ProjectDetailsComponent)
  }
];
