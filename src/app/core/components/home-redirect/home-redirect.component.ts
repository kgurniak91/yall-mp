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
    const lastProject = appStateService.lastOpenedProject();
    const targetUrl = lastProject ? `/project/${lastProject.id}` : '/project/new';
    router.navigateByUrl(targetUrl, {replaceUrl: true});
  }
}
