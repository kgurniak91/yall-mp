import {Component, computed, effect, inject, OnInit, signal, untracked} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {ProjectSettingsComponent} from '../../shared/components/project-settings/project-settings.component';
import {KeyboardShortcutsService} from './keyboard-shortcuts/keyboard-shortcuts.service';
import {SeekDirection} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ProjectHeaderComponent} from './project-header/project-header.component';
import {ActivatedRoute, Router} from '@angular/router';
import {ConfirmationService} from 'primeng/api';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Project} from '../../model/project.types';
import {ProjectSettingsStateService} from '../../state/project-settings/project-settings-state.service';
import {BuiltInSettingsPresets, HiddenSubtitleStyle, ProjectSettings, SettingsPreset} from '../../model/settings.types';
import {DialogService, DynamicDialogRef} from 'primeng/dynamicdialog';
import {CommandHistoryStateService} from '../../state/command-history/command-history-state.service';
import {EditSubtitlesDialogComponent} from './edit-subtitles-dialog/edit-subtitles-dialog.component';
import {UpdateClipTextCommand} from '../../model/commands/update-clip-text.command';
import {take} from 'rxjs';
import {ToastService} from '../../shared/services/toast/toast.service';
import type {SubtitleData} from '../../../../shared/types/subtitle.type';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {GlobalSettingsDialogComponent} from '../global-settings-dialog/global-settings-dialog.component';
import {DropdownModule} from 'primeng/dropdown';
import {FormsModule} from '@angular/forms';
import {Fieldset} from 'primeng/fieldset';
import {Select} from 'primeng/select';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoControllerComponent,
    TimelineEditorComponent,
    Button,
    Tooltip,
    Drawer,
    ProjectSettingsComponent,
    Popover,
    ProjectHeaderComponent,
    DropdownModule,
    FormsModule,
    Fieldset,
    Select
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss',
  providers: [
    KeyboardShortcutsService,
    ClipsStateService,
    CommandHistoryStateService,
    ProjectSettingsStateService,
    VideoStateService
  ]
})
export class ProjectDetailsComponent implements OnInit {
  protected currentClipHasSubtitles = computed(() => !!this.clipsStateService.currentClip()?.hasSubtitle);

  protected isFirstClip = computed(() => {
    const clips = this.clipsStateService.clips();
    if (clips.length === 0) {
      return true; // No clips, so it's the "first"
    }
    return this.clipsStateService.currentClipIndex() === 0;
  });

  protected isLastClip = computed(() => {
    const clips = this.clipsStateService.clips();
    if (clips.length === 0) {
      return true; // No clips, so it's the "last"
    }
    return this.clipsStateService.currentClipIndex() === (clips.length - 1);
  });

  protected isGoToPreviousSubtitledClipActionDisabled = computed(() => {
    const clips = this.clipsStateService.clips();
    const currentIndex = this.clipsStateService.currentClipIndex();
    const currentClip = this.clipsStateService.currentClip();

    if (!currentClip) {
      return true;
    }

    const previousSubtitledClipExists = clips.some((clip, index) => (index < currentIndex) && clip.hasSubtitle);
    if (previousSubtitledClipExists) {
      return false;
    }

    // Playback indicator is either at the 1st gap or 1st subtitled clip
    // If it is at the gap and there are no subtitled clips before, disable the action:
    if (!currentClip.hasSubtitle) {
      return true;
    }

    // Otherwise, it is at the 1st subtitled clip - enable action to allow rewinding to the beginning of it:
    return false;
  });

  protected isGoToNextSubtitledClipActionDisabled = computed(() => {
    const clips = this.clipsStateService.clips();
    const currentIndex = this.clipsStateService.currentClipIndex();
    const nextSubtitledClipExists = clips.some((clip, index) => (index > currentIndex) && clip.hasSubtitle);
    return !nextSubtitledClipExists;
  });

  protected readonly isSettingsVisible = signal(false);
  protected readonly commandHistoryStateService = inject(CommandHistoryStateService);
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly HiddenSubtitleStyle = HiddenSubtitleStyle;
  protected readonly project = signal<Project | null>(null);
  protected readonly mediaPath = signal<string | null>(null);
  protected readonly settingsPresets = signal<SettingsPreset[]>(BuiltInSettingsPresets);
  protected readonly selectedSettingsPreset = signal<SettingsPreset | null>(null);
  private wasPlayingBeforeSettingsOpened = false;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsStateService = inject(ProjectsStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private dialogRef: DynamicDialogRef | undefined;

  constructor() {
    inject(KeyboardShortcutsService); // start listening

    effect(() => {
      const currentSettings = this.projectSettingsStateService.settings();
      const currentProject = this.project();
      if (currentProject) {
        this.projectsStateService.updateProject(currentProject.id, {settings: currentSettings});
      }
    });

    effect(() => {
      const duration = this.videoStateService.duration();
      const project = this.project();

      if (project && duration > 0 && project.duration !== duration) {
        this.projectsStateService.updateProject(project.id, {duration: duration});
      }
    });

    effect(() => {
      const project = this.project();
      const duration = this.videoStateService.duration();

      if (project && duration > 0) {
        const seekTime = untracked(() => project.lastPlaybackTime);

        if (seekTime > 0) {
          this.videoStateService.seekAbsolute(seekTime);
        }
      }
    });
  }

  async ngOnInit() {
    const projectId = this.route.snapshot.paramMap.get('id');

    if (!projectId) {
      this.toastService.error('No project ID provided');
      this.router.navigate(['/projects']);
      return;
    }

    const foundProject = this.projectsStateService.getProjectById(projectId);

    if (!foundProject) {
      this.toastService.error(`Project with ID ${projectId} not found`);
      this.router.navigate(['/projects']);
      return;
    }

    this.project.set(foundProject);
    this.mediaPath.set(foundProject!.mediaPath);
    this.projectSettingsStateService.setSettings(foundProject.settings);
    this.projectsStateService.setCurrentProject(projectId);
    this.clipsStateService.setProjectId(projectId);
    this.videoStateService.setProjectId(projectId);

    const hasExistingSubtitles = foundProject?.subtitles?.length > 0;
    const hasSubtitleFile = foundProject?.subtitlePath?.length > 0;

    let subtitles: SubtitleData[];
    if (hasExistingSubtitles) {
      subtitles = foundProject.subtitles;
    } else if (hasSubtitleFile) {
      subtitles = await window.electronAPI.parseSubtitleFile(foundProject.subtitlePath);
    } else {
      subtitles = [];
    }

    this.clipsStateService.setSubtitles(subtitles);
  }

  goToNextSubtitledClip() {
    this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Next);
  }

  goToPreviousSubtitledClip() {
    this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Previous);
  }

  togglePlayPause() {
    this.videoStateService.togglePlayPause();
  }

  repeatCurrentClip() {
    this.videoStateService.repeatCurrentClip();
  }

  adjustClipStartLeft(): void {
    this.clipsStateService.adjustCurrentClipBoundary('start', 'left');
  }

  adjustClipStartRight(): void {
    this.clipsStateService.adjustCurrentClipBoundary('start', 'right');
  }

  adjustClipEndLeft(): void {
    this.clipsStateService.adjustCurrentClipBoundary('end', 'left');
  }

  adjustClipEndRight(): void {
    this.clipsStateService.adjustCurrentClipBoundary('end', 'right');
  }

  toggleSettings(): void {
    const videoElement = this.videoStateService.videoElement();
    if (!videoElement) return;

    if (!this.isSettingsVisible()) {
      this.wasPlayingBeforeSettingsOpened = !videoElement.paused;

      if (this.wasPlayingBeforeSettingsOpened) {
        videoElement.pause();
      }

      this.isSettingsVisible.set(true);
    } else {
      this.isSettingsVisible.set(false);

      if (this.wasPlayingBeforeSettingsOpened) {
        videoElement.play();
      }

      this.wasPlayingBeforeSettingsOpened = false;
    }
  }

  openEditSubtitlesDialog(): void {
    const currentClip = this.clipsStateService.currentClip();
    if (!currentClip || !currentClip.hasSubtitle) {
      return;
    }

    this.dialogRef = this.dialogService.open(EditSubtitlesDialogComponent, {
      header: 'Edit Subtitles',
      width: '50vw',
      modal: true,
      data: {
        text: currentClip.text || ''
      }
    });

    this.dialogRef.onClose.pipe(
      take(1)
    ).subscribe((newText: string | undefined) => {
      if (newText !== undefined && newText !== currentClip.text) {
        const command = new UpdateClipTextCommand(
          this.clipsStateService,
          currentClip.id,
          currentClip.text || '',
          newText
        );
        this.commandHistoryStateService.execute(command);
      }
    });
  }

  undo(): void {
    this.commandHistoryStateService.undo();
  }

  redo(): void {
    this.commandHistoryStateService.redo();
  }

  onNewProjectClicked() {
    this.router.navigate(['/project/new']);
  }

  onEditProjectClicked() {
    const project = this.project();
    if (project) {
      this.router.navigate(['/project/edit', project.id]);
    }
  }

  onGoToProjectsListClicked() {
    this.router.navigate(['/projects']);
  }

  onHelpClicked() {
    // TODO
  }

  onSettingsPresetChange(preset: SettingsPreset | null): void {
    this.selectedSettingsPreset.set(preset);

    if (preset) {
      const currentProjectSettings = this.projectSettingsStateService.settings();
      this.projectSettingsStateService.setSettings({
        ...currentProjectSettings,
        ...preset.settings
      });
    }
  }

  onGlobalSettingsClicked() {
    this.dialogService.open(GlobalSettingsDialogComponent, {
      header: 'Global settings',
      width: 'clamp(20rem, 95vw, 60rem)',
      focusOnShow: false,
      closable: true,
      modal: true
    });
  }

  onDeleteProjectClicked() {
    const project = this.project();
    if (project) {
      // TODO refactor duplicated code
      this.confirmationService.confirm({
        header: 'Confirm deletion',
        message: `Are you sure you want to delete the project <b>${project.mediaFileName}</b>?<br>This action cannot be undone.`,
        icon: 'fa-solid fa-circle-exclamation',
        accept: () => this.projectsStateService.deleteProject(project.id)
      });
    }
  }

  private toggleSettingsRequestListener = effect(() => {
    if (this.videoStateService.toggleSettingsRequest()) {
      this.toggleSettings();
      this.videoStateService.clearToggleSettingsRequest();
    }
  });

  private editCurrentSubtitlesListener = effect(() => {
    if (this.videoStateService.editSubtitlesRequest()) {
      this.openEditSubtitlesDialog();
      this.videoStateService.clearEditSubtitlesRequest();
    }
  });

  private matchingSettingsPresetListener = effect(() => {
    const currentSettings = this.projectSettingsStateService.settings();

    const matchingPreset = this.settingsPresets().find(preset =>
      Object.entries(preset.settings).every(([key, value]) =>
        currentSettings[key as keyof ProjectSettings] === value
      )
    );

    this.selectedSettingsPreset.set(matchingPreset || null);
  });
}
