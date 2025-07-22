import {Routes} from '@angular/router';
import {inject} from '@angular/core';
import {AppStateService} from './state/app/app-state.service';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => {
      const appStateService = inject(AppStateService);
      const lastProject = appStateService.lastOpenedProject();
      return lastProject ? `/project/${lastProject.id}` : '/project/new';
    }
  },
  {
    path: 'projects',
    loadComponent: () => import('./features/list-of-projects/list-of-projects.component').then(m => m.ListOfProjectsComponent)
  },
  {
    path: 'project/new',
    loadComponent: () => import('./features/project-form/project-form.component').then(m => m.ProjectFormComponent)
  },
  {
    path: 'project/edit/:id',
    loadComponent: () => import('./features/project-form/project-form.component').then(m => m.ProjectFormComponent)
  },
  {
    path: 'project/:id',
    loadComponent: () => import('./features/project-details/project-details.component').then(m => m.ProjectDetailsComponent)
  }
];
