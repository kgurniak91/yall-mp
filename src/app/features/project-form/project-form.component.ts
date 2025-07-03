import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Project} from '../../model/project.types';
import {ConfirmationService, MessageService} from 'primeng/api';
import {Button} from 'primeng/button';
import {FileDropZoneComponent} from '../../shared/components/file-drop-zone/file-drop-zone.component';
import {v4 as uuidv4} from 'uuid';
import {Location} from '@angular/common';

const EDIT_CONFIRMATION_MESSAGE = `
Are you sure you want to edit this project?
<br>
This action will reset all your progress:
<ul>
<li>Playback position</li>
<li>Clip timings</li>
<li>Subtitle edits</li>
</ul>
This action cannot be undone.
`;

@Component({
  selector: 'app-new-project',
  imports: [
    Button,
    FileDropZoneComponent
  ],
  templateUrl: './project-form.component.html',
  styleUrl: './project-form.component.scss'
})
export class ProjectFormComponent implements OnInit {
  protected readonly mediaFile = signal<File | null>(null);
  protected readonly subtitleFile = signal<File | null>(null);
  protected readonly existingMediaFileName = signal<string | null>(null);
  protected readonly existingSubtitleFileName = signal<string | null>(null);
  protected readonly editMode = signal(false);
  protected readonly pageTitle = computed(() => this.editMode() ? 'Edit Project' : 'Create a New Project');
  private readonly isValid = computed(() => Boolean(this.mediaFile()) && Boolean(this.subtitleFile()));
  private readonly editingProjectId = signal<string | null>(null);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly projectsStateService = inject(ProjectsStateService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly location = inject(Location);

  ngOnInit(): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      this.editMode.set(true);
      this.editingProjectId.set(projectId);
      const project = this.projectsStateService.getProjectById(projectId);
      if (project) {
        this.existingMediaFileName.set(project.mediaFileName);
        this.existingSubtitleFileName.set(project.subtitleFileName);
      } else {
        this.goBack();
      }
    }
  }

  protected onMediaFileChange(file: File | null) {
    this.mediaFile.set(file);
    if (!file) {
      this.existingMediaFileName.set(null);
    }
  }

  protected onSubtitleFileChange(file: File | null) {
    this.subtitleFile.set(file);
    if (!file) {
      this.existingSubtitleFileName.set(null);
    }
  }

  protected goBack(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/projects']);
    }
  }

  protected submitProject(): void {
    if (this.editMode()) {
      this.confirmationService.confirm({
        header: 'Confirm changes',
        message: EDIT_CONFIRMATION_MESSAGE,
        icon: 'fa-solid fa-circle-exclamation',
        accept: () => this.editExistingProject()
      });
    } else {
      this.createNewProject();
    }
  }

  private createNewProject() {
    if (!this.isValid()) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Both media and subtitle files are required.'
      })
      return;
    }

    const media = this.mediaFile()!;
    const subtitle = this.subtitleFile()!;
    const now = Date.now();

    const newProject: Project = {
      id: uuidv4(),
      mediaFileName: media.name,
      subtitleFileName: subtitle.name,
      mediaUrl: URL.createObjectURL(media),
      subtitleUrl: URL.createObjectURL(subtitle),
      lastOpenedDate: now,
      createdDate: now,
      duration: 0,
      lastPlaybackTime: 0,
      lastSubtitledClipEndTime: 0,
      subtitledClipsCount: 0,
      // TODO FileSystemFileHandle
    };

    this.projectsStateService.createProject(newProject);

    this.router.navigate(['/project', newProject.id]);
  }

  private editExistingProject(): void {
    const projectId = this.editingProjectId();
    if (!projectId) return;

    const newVideo = this.mediaFile();
    const newSubtitle = this.subtitleFile();

    const updates: Partial<Project> = {};

    if (newVideo) {
      updates.mediaUrl = URL.createObjectURL(newVideo);
      updates.mediaFileName = newVideo.name;
      updates.duration = 0; // TODO
    }

    if (newSubtitle) {
      updates.subtitleUrl = URL.createObjectURL(newSubtitle);
      updates.subtitleFileName = newSubtitle.name;
      // TODO update subtitle stats here as well if a new sub file is provided
    }

    this.projectsStateService.updateProject(projectId, updates);
    this.router.navigate(['/projects']);
  }
}
