import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'project/1', // TODO 'list-of-projects'
    pathMatch: 'full'
  },
  {
    path: 'list-of-projects',
    loadComponent: () => import('./features/list-of-projects/list-of-projects.component').then(m => m.ListOfProjectsComponent)
  },
  {
    path: 'project/:id',
    loadComponent: () => import('./features/project-details/project-details.component').then(m => m.ProjectDetailsComponent)
  }
];
