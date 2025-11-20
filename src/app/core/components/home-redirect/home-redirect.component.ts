import {Component, inject, OnInit} from '@angular/core';
import {AppStateService} from '../../../state/app/app-state.service';
import {Router} from '@angular/router';
import {FileOpenIntentService} from '../../services/file-open-intent/file-open-intent.service';
import {ToastService} from '../../../shared/services/toast/toast.service';

@Component({
  selector: 'app-home-redirect',
  imports: [],
  template: '<!-- for redirects only -->'
})
export class HomeRedirectComponent implements OnInit {
  private readonly appStateService = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly fileOpenIntentService = inject(FileOpenIntentService);
  private readonly toastService = inject(ToastService);

  async ngOnInit() {
    // Check if app was launched with file(s) via "Open With"
    const pendingFiles = await window.electronAPI.getPendingOpenFiles();

    if (pendingFiles && pendingFiles.length > 0) {
      const error = await this.fileOpenIntentService.processFiles(pendingFiles);
      if (error) {
        this.toastService.error(error);
        // Fall through to default logic below if there was an error processing files
      } else {
        // Success - navigation already happened inside `fileOpenIntentService`. Stop here.
        return;
      }
    }

    // Default startup logic
    const currentProject = this.appStateService.currentProject();
    const projects = this.appStateService.projects();
    let targetUrl: string;

    if (currentProject) {
      targetUrl = `/project/${currentProject.id}`;
    } else if (projects.length > 0) {
      targetUrl = '/projects';
    } else {
      targetUrl = '/project/new';
    }

    this.router.navigateByUrl(targetUrl, {replaceUrl: true});
  }
}
