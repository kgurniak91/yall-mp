import {inject} from '@angular/core';
import {ActivatedRouteSnapshot, ResolveFn, Router} from '@angular/router';
import {EMPTY, forkJoin, from, Observable, of} from 'rxjs';
import {catchError, switchMap} from 'rxjs/operators';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {Project} from '../../../model/project.types';
import {AppStateService} from '../../../state/app/app-state.service';

export const projectResolver: ResolveFn<Project> = (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const appStateService = inject(AppStateService);
  const toastService = inject(ToastService);
  const projectId = route.paramMap.get('id');

  if (!projectId) {
    toastService.error('No project ID provided');
    router.navigate(['/projects']);
    return EMPTY;
  }

  return from(appStateService.getProjectById(projectId)).pipe(
    switchMap(project => {
      if (!project) {
        toastService.error(`Project with ID ${projectId} not found`);
        router.navigate(['/projects']);
        return EMPTY;
      }

      const mediaCheck$ = from(window.electronAPI.checkFileExists(project.mediaPath));
      let subtitleCheck$: Observable<boolean>;

      if (project.subtitleSelection.type === 'external') {
        subtitleCheck$ = from(window.electronAPI.checkFileExists(project.subtitleSelection.filePath));
      } else {
        subtitleCheck$ = of(true); // Default to true (passes the check)
      }

      return forkJoin([mediaCheck$, subtitleCheck$]).pipe(
        switchMap(([mediaExists, subtitlesExist]) => {
          if (!mediaExists || !subtitlesExist) {
            const missingItems = [];

            if (!mediaExists) {
              missingItems.push('media file');
            }

            if (!subtitlesExist) {
              missingItems.push('subtitle file');
            }

            const noun = (missingItems.length === 2) ? 'files' : 'file';

            toastService.error(
              `Could not open project: The ${missingItems.join(' and ')} could not be found.\nPlease restore the ${noun} or edit the project to select new ${noun}.`,
            );
            router.navigate(['/projects']);
            return EMPTY;
          }

          if (appStateService.currentProjectId() !== projectId) {
            return from(appStateService.setCurrentProject(projectId)).pipe(
              switchMap(() => of(project))
            );
          }

          return of(project);
        })
      );
    }),
    catchError((err) => {
      console.error('Resolver error:', err);
      router.navigate(['/projects']);
      return EMPTY;
    })
  );
};
