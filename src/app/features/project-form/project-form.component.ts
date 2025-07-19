import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Project} from '../../model/project.types';
import {ConfirmationService} from 'primeng/api';
import {Button} from 'primeng/button';
import {FileDropZoneComponent} from '../../shared/components/file-drop-zone/file-drop-zone.component';
import {v4 as uuidv4} from 'uuid';
import {Location} from '@angular/common';
import {ToastService} from '../../shared/services/toast/toast.service';
import {SUPPORTED_MEDIA_TYPES, SUPPORTED_SUBTITLE_TYPES} from '../../model/video.types';
import {DEFAULT_PROJECT_SETTINGS} from '../../model/settings.types';

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
  protected readonly mediaFilePath = signal<string | null>(null);
  protected readonly subtitleFilePath = signal<string | null>(null);
  protected readonly existingMediaFileName = signal<string | null>(null);
  protected readonly existingSubtitleFileName = signal<string | null>(null);
  protected readonly mediaFileJustChanged = signal(false);
  protected readonly subtitleFileJustChanged = signal(false);
  protected readonly editMode = signal(false);
  protected readonly pageTitle = computed(() => this.editMode() ? 'Edit Project' : 'Create a New Project');
  protected readonly SUPPORTED_SUBTITLE_TYPES = SUPPORTED_SUBTITLE_TYPES;
  protected readonly SUPPORTED_MEDIA_TYPES = SUPPORTED_MEDIA_TYPES;
  private readonly isValid = computed(() => Boolean(this.mediaFilePath()) && Boolean(this.subtitleFilePath()));
  private readonly editingProjectId = signal<string | null>(null);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly projectsStateService = inject(ProjectsStateService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly location = inject(Location);

  ngOnInit(): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      this.editMode.set(true);
      this.editingProjectId.set(projectId);
      const project = this.projectsStateService.getProjectById(projectId);
      if (project) {
        this.mediaFilePath.set(project.mediaPath);
        this.subtitleFilePath.set(project.subtitlePath);
        this.existingMediaFileName.set(project.mediaFileName);
        this.existingSubtitleFileName.set(project.subtitleFileName);
      } else {
        this.toastService.error('Project not found');
        this.goBack();
      }
    }
  }

  protected onMediaFilePathChange(path: string | null) {
    this.mediaFilePath.set(path);
    this.mediaFileJustChanged.set(true);
    if (!path) {
      this.existingMediaFileName.set(null);
    }
  }

  protected onSubtitleFilePathChange(path: string | null) {
    this.subtitleFilePath.set(path);
    this.subtitleFileJustChanged.set(true);
    if (!path) {
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
      this.toastService.error('Both media and subtitle files are required');
      return;
    }

    const mediaPath = this.mediaFilePath()!;
    const subtitlePath = this.subtitleFilePath()!;
    const now = Date.now();

    const newProject: Project = {
      id: uuidv4(),
      mediaFileName: this.getBaseName(mediaPath),
      subtitleFileName: this.getBaseName(subtitlePath),
      mediaPath: mediaPath,
      subtitlePath: subtitlePath,
      lastOpenedDate: now,
      createdDate: now,
      duration: 0,
      lastPlaybackTime: 0,
      settings: {...DEFAULT_PROJECT_SETTINGS},
      subtitles: []
    };

    this.projectsStateService.createProject(newProject);
    this.router.navigate(['/project', newProject.id]);
  }

  private editExistingProject(): void {
    const projectId = this.editingProjectId();
    if (!projectId) return;

    const mediaPath = this.mediaFilePath()!;
    const subtitlePath = this.subtitleFilePath()!;

    const updates: Partial<Project> = {
      mediaPath: mediaPath,
      subtitlePath: subtitlePath,
      mediaFileName: this.getBaseName(mediaPath),
      subtitleFileName: this.getBaseName(subtitlePath),
      duration: 0,
      lastPlaybackTime: 0
    };

    this.projectsStateService.updateProject(projectId, updates);
    this.toastService.success();
    this.router.navigate(['/project', projectId]);
  }

  private getBaseName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || '';
  }
}
