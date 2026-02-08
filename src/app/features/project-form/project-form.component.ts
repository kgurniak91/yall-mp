import {ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal} from '@angular/core';
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
import {finalize, firstValueFrom, forkJoin, from, timer} from 'rxjs';
import {SUBTITLE_OPTIONS, SubtitleOptionType} from './project-form.type';
import {SpinnerComponent} from '../../shared/components/spinner/spinner.component';
import {generateTagFromFileName} from '../../shared/utils/tag/tag.utils';
import {FileOpenIntentService} from '../../core/services/file-open-intent/file-open-intent.service';
import {TreeSelectModule} from 'primeng/treeselect';
import {ROOT_CATALOG_ID} from '../../shared/types/catalog.types';
import {CatalogSelectComponent} from '../../shared/components/catalog-select/catalog-select.component';
import {isEqual} from 'lodash-es';

const EDIT_CONFIRMATION_MESSAGE = `
Are you sure you want to edit this project?
<br>
This action will reset all your progress:
<ul>
<li>Playback position</li>
<li>Clip timings</li>
<li>Subtitle edits</li>
<li>Audio waveform</li>
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
    SpinnerComponent,
    TreeSelectModule,
    CatalogSelectComponent
  ],
  templateUrl: './project-form.component.html',
  styleUrl: './project-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProjectFormComponent implements OnInit {
  protected readonly isLoading = signal(true);
  protected readonly mediaFilePath = signal<string | null>(null);
  protected readonly existingMediaFileName = signal<string | null>(null);
  protected readonly existingSubtitleFileName = signal<string | null>(null);
  protected readonly editMode = signal(false);
  protected readonly pageTitle = computed(() => this.editMode() ? 'Edit Project' : 'Create New Project');
  protected readonly SUPPORTED_SUBTITLE_TYPES = SUPPORTED_SUBTITLE_TYPES;
  protected readonly SUPPORTED_MEDIA_TYPES = SUPPORTED_MEDIA_TYPES;
  protected readonly audioTracks = signal<MediaTrack[]>([]);
  protected readonly selectedSubtitleOption = signal<'embedded' | 'external' | 'none'>('external');
  protected readonly selectedEmbeddedSubtitleTrackIndex = signal<number | null>(null);
  protected readonly selectedAudioTrackIndex = signal<number | null>(null);
  protected readonly isProcessingMedia = signal(false);

  protected readonly audioTrackOptions = computed(() => {
    return this.audioTracks().map(track => ({
      label: track.label || `Track ${track.index}`,
      value: track.index
    }));
  });

  protected readonly subtitleTrackOptions = computed(() => {
    return this.subtitleTracks().map(track => {
      let label = track.label || `Track ${track.index}`;

      if (track.isSupported === false) {
        label = `${label} (image-based subtitles - unsupported)`;
      }

      return {
        label: label,
        value: track.index,
        disabled: !track.isSupported
      };
    });
  });

  protected readonly isValid = computed(() => {
    if (!this.mediaFilePath()) {
      return false;
    }

    if (!this.selectedCatalogId()) {
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
  protected readonly selectedCatalogId = signal<string | null>(ROOT_CATALOG_ID);
  private readonly subtitleTracks = signal<MediaTrack[]>([]);
  private readonly videoWidth = signal<number | undefined>(undefined);
  private readonly videoHeight = signal<number | undefined>(undefined);
  private readonly externalSubtitlePath = signal<string | null>(null);
  private readonly editingProjectId = signal<string | null>(null);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appStateService = inject(AppStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly toastService = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly location = inject(Location);
  private readonly fileOpenIntentService = inject(FileOpenIntentService);
  private originalProject: Project | null = null;

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

    effect(() => {
      if (this.fileOpenIntentService.hasIntent()) {
        this.isLoading.set(true);
        this.applyFileIntent();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const projectId = this.route.snapshot.paramMap.get('id');

    if (projectId) {
      this.editMode.set(true);
      this.editingProjectId.set(projectId);
      const project = await this.appStateService.getProjectById(projectId);
      if (project) {
        this.originalProject = project; // Capture state for later comparison when saving
        const mediaFileExists = await window.electronAPI.checkFileExists(project.mediaPath);

        if (mediaFileExists) {
          this.mediaFilePath.set(project.mediaPath);
          this.existingMediaFileName.set(project.mediaFileName);
          this.audioTracks.set(project.audioTracks);
          this.subtitleTracks.set(project.subtitleTracks);
          this.videoWidth.set(project.videoWidth);
          this.videoHeight.set(project.videoHeight);
          this.selectedAudioTrackIndex.set(project.settings.selectedAudioTrackIndex);
        }

        this.selectedSubtitleOption.set(project.subtitleSelection.type);

        switch (project.subtitleSelection.type) {
          case 'external':
            const subtitleFileExists = await window.electronAPI.checkFileExists(project.subtitleSelection.filePath);
            if (subtitleFileExists) {
              this.externalSubtitlePath.set(project.subtitleSelection.filePath);
              this.existingSubtitleFileName.set(project.subtitleFileName);
            }
            break;
          case 'embedded':
            this.selectedEmbeddedSubtitleTrackIndex.set(project.subtitleSelection.trackIndex);
            break;
        }

        this.selectedCatalogId.set(project.catalogId);
        this.isLoading.set(false);
      } else {
        this.toastService.error('Project not found');
        this.goBack();
      }
    } else {
      const activeId = this.appStateService.activeCatalogId();
      this.selectedCatalogId.set(activeId);

      if (!this.fileOpenIntentService.hasIntent()) {
        this.isLoading.set(false);
      }
    }
  }

  protected async onMediaFilePathChange(path: string | null): Promise<void> {
    this.mediaFilePath.set(path);

    if (!path) {
      this.existingMediaFileName.set(null);
      this.audioTracks.set([]);
      this.subtitleTracks.set([]);
      this.videoWidth.set(undefined);
      this.videoHeight.set(undefined);
      this.selectedAudioTrackIndex.set(null);
      return;
    }

    this.isProcessingMedia.set(true);

    const mediaProcessing$ = from(window.electronAPI.getMediaMetadata(path));
    const companionSubtitle$ = from(window.electronAPI.findCompanionSubtitle(path));
    const timer$ = timer(500); // Show spinner for at least 500ms to avoid GUI flickering

    try {
      const [metadata, companionPath] = await firstValueFrom(
        forkJoin([mediaProcessing$, companionSubtitle$, timer$]).pipe(
          finalize(() => this.isProcessingMedia.set(false))
        )
      );

      this.audioTracks.set(metadata.audioTracks);
      this.subtitleTracks.set(metadata.subtitleTracks);
      this.videoWidth.set(metadata.videoWidth);
      this.videoHeight.set(metadata.videoHeight);

      // Auto-select first audio track by default:
      if (metadata.audioTracks.length > 0) {
        this.selectedAudioTrackIndex.set(metadata.audioTracks[0].index);
      }

      if (companionPath) {
        this.selectedSubtitleOption.set('external');
        this.onSubtitleFilePathChange(companionPath);
        this.existingSubtitleFileName.set(this.getBaseName(companionPath));
      } else if (metadata.subtitleTracks.length > 0) {
        this.selectedSubtitleOption.set('embedded');
        this.selectedEmbeddedSubtitleTrackIndex.set(null);
      } else {
        this.selectedSubtitleOption.set('external');
      }
    } catch (e: any) {
      this.toastService.error(`Failed to read media metadata: ${e.message}`);
      this.audioTracks.set([]);
      this.subtitleTracks.set([]);
      this.videoWidth.set(undefined);
      this.videoHeight.set(undefined);
      this.selectedAudioTrackIndex.set(null);
    }
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
      if (this.hasDestructiveChanges()) {
        this.confirmationService.confirm({
          header: 'Confirm changes',
          message: EDIT_CONFIRMATION_MESSAGE,
          icon: 'fa-solid fa-circle-exclamation',
          accept: () => this.editExistingProject()
        });
      } else {
        // Safe updates (e.g., catalog change) don't need confirmation
        this.editExistingProject();
      }
    } else {
      this.createNewProject();
    }
  }

  private hasDestructiveChanges(): boolean {
    if (!this.originalProject) {
      return true;
    }

    const mediaPath = this.mediaFilePath();
    const {subtitleSelection} = this.buildSubtitleSelection();
    const audioTrackIndex = this.selectedAudioTrackIndex();

    // Check media
    if (this.originalProject.mediaPath !== mediaPath) {
      return true;
    }

    // Check audio track
    if (this.originalProject.settings.selectedAudioTrackIndex !== audioTrackIndex) {
      return true;
    }

    // Check subtitles
    if (!isEqual(this.originalProject.subtitleSelection, subtitleSelection)) {
      return true;
    }

    return false;
  }

  private async applyFileIntent() {
    const mediaPath = this.fileOpenIntentService.intentMedia();
    const subPath = this.fileOpenIntentService.intentSubtitle();

    this.fileOpenIntentService.clearIntent();

    try {
      if (mediaPath) {
        this.editMode.set(false);
        await this.onMediaFilePathChange(mediaPath);
        this.existingMediaFileName.set(this.getBaseName(mediaPath));
      }

      if (subPath) {
        this.selectedSubtitleOption.set('external');
        this.onSubtitleFilePathChange(subPath);
        this.existingSubtitleFileName.set(this.getBaseName(subPath));
      }
    } finally {
      this.isLoading.set(false);
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
    const mediaFileName = this.getBaseName(mediaPath);
    const generatedAnkiTag = generateTagFromFileName(mediaFileName);
    const catalogId = this.selectedCatalogId()!; // Validated by isValid()

    const newProject: Project = {
      id: uuidv4(),
      catalogId,
      mediaFileName,
      subtitleFileName: subtitleFileName,
      mediaPath: mediaPath,
      subtitleSelection: subtitleSelection,
      lastOpenedDate: now,
      createdDate: now,
      duration: 0,
      lastPlaybackTime: 0,
      settings: {
        ...this.globalSettingsStateService.defaultProjectSettings(),
        selectedAudioTrackIndex: this.selectedAudioTrackIndex()
      },
      subtitles: [],
      lastSubtitleEndTime: 0,
      audioTracks: this.audioTracks(),
      subtitleTracks: this.subtitleTracks(),
      videoWidth: this.videoWidth(),
      videoHeight: this.videoHeight(),
      detectedLanguage: 'other',
      ankiTags: [generatedAnkiTag],
      lastAnkiSuspendState: this.globalSettingsStateService.ankiSuspendNewCardsByDefault()
    };
    this.appStateService.createProject(newProject);
    this.router.navigate(['/project', newProject.id]);
  }

  private async editExistingProject(): Promise<void> {
    const projectId = this.editingProjectId();
    if (!projectId || !this.isValid()) {
      this.showInvalidFormToast();
      return;
    }

    const mediaPath = this.mediaFilePath()!;
    const {subtitleSelection, subtitleFileName} = this.buildSubtitleSelection();
    const catalogId = this.selectedCatalogId()!; // Validated by isValid()
    const isDestructive = this.hasDestructiveChanges();
    let updates: Partial<Project>;

    if (isDestructive) {
      updates = {
        catalogId,
        mediaPath: mediaPath,
        mediaFileName: this.getBaseName(mediaPath),
        subtitleSelection: subtitleSelection,
        subtitleFileName: subtitleFileName,
        duration: 0,
        lastPlaybackTime: 0,
        subtitles: [],
        settings: {
          ...this.originalProject!.settings,
          selectedAudioTrackIndex: this.selectedAudioTrackIndex()
        },
        audioTracks: this.audioTracks(),
        subtitleTracks: this.subtitleTracks(),
        videoWidth: this.videoWidth(),
        videoHeight: this.videoHeight(),
        audioPeaks: undefined // Force regeneration of audio waveform
      };
    } else {
      // Safe update - only update fields that don't affect timeline
      updates = {
        catalogId
      };
    }

    this.appStateService.updatePartialProject(projectId, updates);
    this.toastService.success('Project updated successfully');

    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/project', projectId]);
    }
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
    if (!this.selectedCatalogId()) {
      this.toastService.error('Please select a catalog');
      return;
    }
    this.toastService.error('Select the media file and pick correct option for subtitles');
  }
}
