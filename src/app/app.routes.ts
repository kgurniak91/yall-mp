import {Routes} from '@angular/router';
import {projectResolver} from './features/project-details/project-resolver/project.resolver';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./core/components/home-redirect/home-redirect.component').then(m => m.HomeRedirectComponent)
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
    loadComponent: () => import('./features/project-details/project-details.component').then(m => m.ProjectDetailsComponent),
    resolve: {
      project: projectResolver
    }
  }
];
