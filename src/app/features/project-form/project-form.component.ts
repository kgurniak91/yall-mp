import {Component, computed, effect, inject, OnInit, signal} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {AppStateService} from '../../state/app/app-state.service';
import {Project, SubtitleSelection} from '../../model/project.types';
import {ConfirmationService} from 'primeng/api';
import {Button} from 'primeng/button';
import {FileDropZoneComponent} from '../../shared/components/file-drop-zone/file-drop-zone.component';
import {v4 as uuidv4} from 'uuid';
import {Location} from '@angular/common';
import {ToastService} from '../../shared/services/toast/toast.service';
import {SUPPORTED_MEDIA_TYPES, SUPPORTED_SUBTITLE_TYPES} from '../../model/video.types';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {Select} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {MediaTrack} from '../../../../shared/types/media.type';
import {finalize, forkJoin, from, timer} from 'rxjs';
import {SUBTITLE_OPTIONS, SubtitleOptionType} from './project-form.type';
import {SpinnerComponent} from '../../shared/components/spinner/spinner.component';

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
    FileDropZoneComponent,
    Select,
    FormsModule,
    SpinnerComponent
  ],
  templateUrl: './project-form.component.html',
  styleUrl: './project-form.component.scss'
})
export class ProjectFormComponent implements OnInit {
  protected readonly mediaFilePath = signal<string | null>(null);
  protected readonly existingMediaFileName = signal<string | null>(null);
  protected readonly existingSubtitleFileName = signal<string | null>(null);
  protected readonly editMode = signal(false);
  protected readonly pageTitle = computed(() => this.editMode() ? 'Edit Project' : 'Create New Project');
  protected readonly SUPPORTED_SUBTITLE_TYPES = SUPPORTED_SUBTITLE_TYPES;
  protected readonly SUPPORTED_MEDIA_TYPES = SUPPORTED_MEDIA_TYPES;
  protected readonly audioTracks = signal<MediaTrack[]>([]);
  protected readonly subtitleTracks = signal<MediaTrack[]>([]);
  protected readonly selectedSubtitleOption = signal<'embedded' | 'external' | 'none'>('external');
  protected readonly selectedEmbeddedSubtitleTrackIndex = signal<number | null>(null);
  protected readonly isProcessingMedia = signal(false);
  protected readonly isValid = computed(() => {
    if (!this.mediaFilePath()) {
      return false;
    }

    const subOption = this.selectedSubtitleOption();

    switch (subOption) {
      case 'embedded':
        return this.selectedEmbeddedSubtitleTrackIndex() !== null;
      case 'external':
        return Boolean(this.externalSubtitlePath());
      case 'none':
        return true;
      default:
        return false;
    }
  });
  protected readonly subtitleOptions = SUBTITLE_OPTIONS;
  protected readonly SubtitleOptionType = SubtitleOptionType;
  private readonly externalSubtitlePath = signal<string | null>(null);
  private readonly editingProjectId = signal<string | null>(null);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appStateService = inject(AppStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly location = inject(Location);

  constructor() {
    effect(() => {
      const selected = this.selectedSubtitleOption();
      if (selected !== 'external') {
        this.externalSubtitlePath.set(null);
        this.existingSubtitleFileName.set(null);
      }
      if (selected !== 'embedded') {
        this.selectedEmbeddedSubtitleTrackIndex.set(null);
      }
    });
  }

  ngOnInit(): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      this.editMode.set(true);
      this.editingProjectId.set(projectId);
      const project = this.appStateService.getProjectById(projectId);
      if (project) {
        this.mediaFilePath.set(project.mediaPath);
        this.existingMediaFileName.set(project.mediaFileName);
        this.audioTracks.set(project.audioTracks);
        this.subtitleTracks.set(project.subtitleTracks);
        this.selectedSubtitleOption.set(project.subtitleSelection.type);

        switch (project.subtitleSelection.type) {
          case 'external':
            this.externalSubtitlePath.set(project.subtitleSelection.filePath);
            this.existingSubtitleFileName.set(project.subtitleFileName);
            break;
          case 'embedded':
            this.selectedEmbeddedSubtitleTrackIndex.set(project.subtitleSelection.trackIndex);
            break;
        }
      } else {
        this.toastService.error('Project not found');
        this.goBack();
      }
    }
  }

  protected async onMediaFilePathChange(path: string | null) {
    this.mediaFilePath.set(path);

    if (!path) {
      this.existingMediaFileName.set(null);
      this.audioTracks.set([]);
      this.subtitleTracks.set([]);
      return;
    }

    this.isProcessingMedia.set(true);

    const mediaProcessing$ = from(window.electronAPI.getMediaMetadata(path));
    const timer$ = timer(500); // Show spinner for at least 500ms to avoid GUI flickering

    forkJoin([mediaProcessing$, timer$]).pipe(
      finalize(() => this.isProcessingMedia.set(false))
    ).subscribe({
      next: ([metadata]) => {
        this.audioTracks.set(metadata.audioTracks);
        this.subtitleTracks.set(metadata.subtitleTracks);
        if (metadata.subtitleTracks.length > 0) {
          this.selectedSubtitleOption.set('embedded');
          this.selectedEmbeddedSubtitleTrackIndex.set(null);
        } else {
          this.selectedSubtitleOption.set('external');
        }
      },
      error: (e) => {
        this.toastService.error(`Failed to read media metadata: ${e.message}`);
        this.audioTracks.set([]);
        this.subtitleTracks.set([]);
      }
    });
  }

  protected onSubtitleFilePathChange(path: string | null) {
    this.externalSubtitlePath.set(path);
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
      this.showInvalidFormToast();
      return;
    }

    const mediaPath = this.mediaFilePath()!;
    const now = Date.now();
    const {subtitleSelection, subtitleFileName} = this.buildSubtitleSelection();
    const firstAudioTrack = this.audioTracks()[0];
    const newProject: Project = {
      id: uuidv4(),
      mediaFileName: this.getBaseName(mediaPath),
      subtitleFileName: subtitleFileName,
      mediaPath: mediaPath,
      subtitleSelection: subtitleSelection,
      lastOpenedDate: now,
      createdDate: now,
      duration: 0,
      lastPlaybackTime: 0,
      settings: {
        ...this.globalSettingsStateService.defaultProjectSettings(),
        selectedAudioTrackIndex: firstAudioTrack ? firstAudioTrack.index : null
      },
      subtitles: [],
      audioTracks: this.audioTracks(),
      subtitleTracks: this.subtitleTracks()
    };
    this.appStateService.createProject(newProject);
    this.router.navigate(['/project', newProject.id]);
  }

  private editExistingProject(): void {
    const projectId = this.editingProjectId();
    if (!projectId || !this.isValid()) {
      this.showInvalidFormToast();
      return;
    }

    const mediaPath = this.mediaFilePath()!;
    const {subtitleSelection, subtitleFileName} = this.buildSubtitleSelection();
    const firstAudioTrack = this.audioTracks()[0];
    const existingProject = this.appStateService.getProjectById(projectId)!;
    const updates: Partial<Project> = {
      mediaPath: mediaPath,
      mediaFileName: this.getBaseName(mediaPath),
      subtitleSelection: subtitleSelection,
      subtitleFileName: subtitleFileName,
      duration: 0,
      lastPlaybackTime: 0,
      subtitles: [],
      settings: {
        ...existingProject.settings,
        selectedAudioTrackIndex: firstAudioTrack ? firstAudioTrack.index : null
      },
      audioTracks: this.audioTracks(),
      subtitleTracks: this.subtitleTracks()
    };
    this.appStateService.updateProject(projectId, updates);
    this.toastService.success('Project updated successfully');
    this.router.navigate(['/project', projectId]);
  }

  private buildSubtitleSelection(): { subtitleSelection: SubtitleSelection, subtitleFileName: string } {
    const option = this.selectedSubtitleOption();
    if (option === 'none') {
      return {subtitleSelection: {type: 'none'}, subtitleFileName: 'No subtitles'};
    } else if (option === 'embedded') {
      const trackIndex = this.selectedEmbeddedSubtitleTrackIndex()!;
      const track = this.subtitleTracks().find(t => t.index === trackIndex);
      return {
        subtitleSelection: {type: 'embedded', trackIndex},
        subtitleFileName: track?.label || `Embedded Track #${trackIndex}`
      };
    } else { // external
      const filePath = this.externalSubtitlePath()!;
      return {
        subtitleSelection: {type: 'external', filePath},
        subtitleFileName: this.getBaseName(filePath)
      };
    }
  }

  private getBaseName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || '';
  }

  private showInvalidFormToast(): void {
    this.toastService.error('Select the media file and pick correct option for subtitles');
  }
}
