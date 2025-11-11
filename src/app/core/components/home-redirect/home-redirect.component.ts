import {Component, inject} from '@angular/core';
import {AppStateService} from '../../../state/app/app-state.service';
import {Router} from '@angular/router';

@Component({
  selector: 'app-home-redirect',
  imports: [],
  template: '<!-- for redirects only -->'
})
export class HomeRedirectComponent {
  constructor() {
    const appStateService = inject(AppStateService);
    const router = inject(Router);
    const currentProject = appStateService.currentProject();
    const projects = appStateService.projects();
    let targetUrl: string;

    if (currentProject) {
      targetUrl = `/project/${currentProject.id}`;
    } else if (projects.length > 0) {
      targetUrl = '/projects';
    } else {
      targetUrl = '/project/new';
    }

    router.navigateByUrl(targetUrl, {replaceUrl: true});
  }
}
