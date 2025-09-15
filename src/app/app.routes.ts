import {Routes} from '@angular/router';
import {
  KeyboardShortcutsService
} from './features/project-details/services/keyboard-shortcuts/keyboard-shortcuts.service';
import {
  SubtitlesHighlighterService
} from './features/project-details/services/subtitles-highlighter/subtitles-highlighter.service';
import {ClipsStateService} from './state/clips/clips-state.service';
import {CommandHistoryStateService} from './state/command-history/command-history-state.service';
import {ProjectSettingsStateService} from './state/project-settings/project-settings-state.service';
import {VideoStateService} from './state/video/video-state.service';
import {FontInjectionService} from './features/project-details/services/font-injection/font-injection.service';
import {AssEditService} from './features/project-details/services/ass-edit/ass-edit.service';

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
    providers: [
      KeyboardShortcutsService,
      SubtitlesHighlighterService,
      ClipsStateService,
      CommandHistoryStateService,
      ProjectSettingsStateService,
      VideoStateService,
      FontInjectionService,
      AssEditService
    ]
  }
];
