import {Component, computed, inject, signal} from '@angular/core';
import {Router} from '@angular/router';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Project} from '../../model/project.types';
import {MessageService} from 'primeng/api';
import {Button} from 'primeng/button';
import {FileDropZoneComponent} from '../../shared/components/file-drop-zone/file-drop-zone.component';
import {v4 as uuidv4} from 'uuid';

@Component({
  selector: 'app-new-project',
  imports: [
    Button,
    FileDropZoneComponent
  ],
  templateUrl: './new-project.component.html',
  styleUrl: './new-project.component.scss'
})
export class NewProjectComponent {
  protected readonly videoFile = signal<File | null>(null);
  protected readonly subtitleFile = signal<File | null>(null);
  private readonly isValid = computed(() => Boolean(this.videoFile()) && Boolean(this.subtitleFile()));
  private readonly router = inject(Router);
  private readonly projectsStateService = inject(ProjectsStateService);
  private readonly messageService = inject(MessageService);

  createProject(): void {
    if (!this.isValid()) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Both video and subtitle files are required.'
      })
      return;
    }

    const video = this.videoFile()!;
    const subtitle = this.subtitleFile()!;
    const now = Date.now();

    const newProject: Project = {
      id: uuidv4(),
      mediaFileName: video.name,
      subtitleFileName: subtitle.name,
      videoUrl: URL.createObjectURL(video),
      subtitleUrl: URL.createObjectURL(subtitle),
      lastOpenedDate: now,
      createdDate: now,
      duration: 0,
      lastPlaybackTime: 0,
      lastSubtitledClipEndTime: 0,
      subtitledClipsCount: 0,
      // TODO FileSystemFileHandle
    };

    this.projectsStateService.addProject(newProject);

    this.router.navigate(['/project', newProject.id]);
  }
}
