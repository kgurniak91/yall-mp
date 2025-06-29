import {Component, computed, input, output} from '@angular/core';
import {Project} from '../../../model/project.types';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {DatePipe} from '@angular/common';
import {ProgressBar} from 'primeng/progressbar';

@Component({
  selector: 'app-project-list-item',
  imports: [
    Button,
    Tooltip,
    DatePipe,
    ProgressBar
  ],
  templateUrl: './project-list-item.component.html',
  styleUrl: './project-list-item.component.scss'
})
export class ProjectListItemComponent {
  project = input.required<Project>();
  selectProject = output<void>();
  editProject = output<void>();
  removeProject = output<void>();

  protected readonly completionPercentage = computed(() => {
    const project = this.project();
    if (!project.duration) {
      return 0;
    } else if (project.lastPlaybackTime >= project.lastSubtitledClipEndTime) {
      return 100;
    } else {
      return (project.lastPlaybackTime / project.duration) * 100;
    }
  });

  protected readonly createdDate = computed(() => new Date(this.project().createdDate));
  protected readonly lastOpenedDate = computed(() => new Date(this.project().lastOpenedDate));
}
