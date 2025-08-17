import {Component, computed, effect, inject, OnInit, signal} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {KeyboardShortcutsService} from './keyboard-shortcuts/keyboard-shortcuts.service';
import {SeekDirection} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ActivatedRoute, Router} from '@angular/router';
import {ConfirmationService} from 'primeng/api';
import {AppStateService} from '../../state/app/app-state.service';
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
import {DropdownModule} from 'primeng/dropdown';
import {FormsModule} from '@angular/forms';
import {AnkiStateService} from '../../state/anki/anki-state.service';
import {ExportToAnkiDialogComponent} from './export-to-anki-dialog/export-to-anki-dialog.component';
import {ExportToAnkiDialogData} from '../../model/anki.types';
import {CurrentProjectSettingsComponent} from './current-project-settings/current-project-settings.component';
import {SubtitlesOverlayComponent} from './subtitles-overlay/subtitles-overlay.component';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoControllerComponent,
    TimelineEditorComponent,
    Button,
    Tooltip,
    Drawer,
    Popover,
    DropdownModule,
    FormsModule,
    CurrentProjectSettingsComponent,
    SubtitlesOverlayComponent
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
  protected readonly ankiStateService = inject(AnkiStateService);
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly HiddenSubtitleStyle = HiddenSubtitleStyle;
  protected readonly project = signal<Project | null>(null);
  protected readonly settingsPresets = signal<SettingsPreset[]>(BuiltInSettingsPresets);
  protected readonly selectedSettingsPreset = signal<SettingsPreset | null>(null);
  private wasPlayingBeforeSettingsOpened = false;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private dialogRef: DynamicDialogRef | undefined;
  private isMpvReady = signal(false);
  private isUiReady = signal(false);
  private hasStartedPlayback = false;

  constructor() {
    inject(KeyboardShortcutsService); // start listening

    effect(() => {
      const currentSettings = this.projectSettingsStateService.settings();
      const currentProject = this.project();
      if (currentProject) {
        this.appStateService.updateProject(currentProject.id, {settings: currentSettings});
      }
    });

    effect(() => {
      const duration = this.videoStateService.duration();
      const project = this.project();

      if (project && duration > 0 && project.duration !== duration) {
        this.appStateService.updateProject(project.id, {duration: duration});
      }
    });

    effect(() => {
      const clips = this.clipsStateService.clips();
      // Wait until UI and MPV are ready, and clips have been generated from the video's duration.
      if (this.isUiReady() && this.isMpvReady() && clips.length > 0) {
        console.log('[ProjectDetails] Both UI and MPV are ready. Requesting initial resize.');
        this.videoStateService.requestForceResize();

        if (!this.hasStartedPlayback) {
          this.hasStartedPlayback = true;
          this.startPlaybackSequence();
        }
      }
    });

    window.electronAPI.onMpvManagerReady(() => {
      console.log('[ProjectDetails] Received mpv:managerReady signal!');
      this.isMpvReady.set(true);
    });
  }

  async ngOnInit() {
    const projectId = this.route.snapshot.paramMap.get('id');

    if (!projectId) {
      this.toastService.error('No project ID provided');
      this.router.navigate(['/projects']);
      return;
    }

    const foundProject = this.appStateService.getProjectById(projectId);

    if (!foundProject) {
      this.toastService.error(`Project with ID ${projectId} not found`);
      this.router.navigate(['/projects']);
      return;
    }

    this.project.set(foundProject);
    this.projectSettingsStateService.setSettings(foundProject.settings);
    this.appStateService.setCurrentProject(projectId);
    this.clipsStateService.setProjectId(projectId);
    this.videoStateService.setProjectId(projectId);
    this.videoStateService.setMediaPath(foundProject.mediaPath);

    const hasExistingSubtitles = foundProject?.subtitles?.length > 0;
    let subtitles: SubtitleData[] = [];

    if (hasExistingSubtitles) {
      subtitles = foundProject.subtitles;
    } else {
      try {
        switch (foundProject.subtitleSelection.type) {
          case 'external':
            subtitles = await window.electronAPI.parseSubtitleFile(foundProject.subtitleSelection.filePath);
            break;
          case 'embedded':
            subtitles = await window.electronAPI.extractSubtitleTrack(foundProject.mediaPath, foundProject.subtitleSelection.trackIndex);
            break;
          case 'none':
            subtitles = [];
            break;
        }
      } catch (e: any) {
        this.toastService.error(`Failed to load subtitles: ${e.message}`);
        subtitles = [];
      }
    }

    this.clipsStateService.setSubtitles(subtitles);
    await window.electronAPI.mpvCreateViewport(foundProject.mediaPath, foundProject.settings.selectedAudioTrackIndex);
  }

  onPlayerReady(): void {
    console.log('[ProjectDetails] Received onPlayerReady signal from UI!');
    this.isUiReady.set(true);
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
    const isVisible = this.isSettingsVisible();

    if (!isVisible) {
      this.wasPlayingBeforeSettingsOpened = this.clipsStateService.isPlaying();
      if (this.wasPlayingBeforeSettingsOpened) {
        window.electronAPI.mpvSetProperty('pause', true);
      }
      this.isSettingsVisible.set(true);
    } else {
      if (this.wasPlayingBeforeSettingsOpened) {
        window.electronAPI.mpvSetProperty('pause', false);
      }
      this.isSettingsVisible.set(false);
      this.wasPlayingBeforeSettingsOpened = false;
    }
  }

  openAnkiExportDialog(): void {
    if (!this.ankiStateService.isAnkiExportAvailable()) {
      this.toastService.error('Anki export is not available. FFmpeg could not be found.');
      return;
    }

    if (this.ankiStateService.status() !== 'connected') {
      this.toastService.error('Failed to connect. Is Anki open?');
      return;
    }

    const currentClip = this.clipsStateService.currentClip();

    if (!currentClip || !currentClip.hasSubtitle) {
      this.toastService.info('Anki export is only available for subtitled clips.');
      return;
    }

    const hasValidTemplates = this.ankiStateService.ankiCardTemplates().some(t => t.isValid);
    if (!hasValidTemplates) {
      this.toastService.warn('Please configure at least one valid Anki template in the global settings.');
      return;
    }

    const data: ExportToAnkiDialogData = {
      subtitleData: currentClip as SubtitleData,
      project: this.project()!,
      exportTime: this.videoStateService.currentTime()
    }

    this.dialogService.open(ExportToAnkiDialogComponent, {
      header: 'Export to Anki',
      width: 'clamp(20rem, 95vw, 40rem)',
      focusOnShow: false,
      modal: true,
      closable: true,
      data
    });
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

  onVideoAreaDoubleClick(): void {
    window.electronAPI.windowHandleDoubleClick();
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

  private requestAnkiExportListener = effect(() => {
    if (this.videoStateService.ankiExportRequest()) {
      this.openAnkiExportDialog();
      this.videoStateService.clearAnkiExportRequest();
    }
  });

  private startPlaybackSequence(): void {
    const project = this.project();
    if (!project) {
      return;
    }

    if (this.videoStateService.duration() <= 0) {
      return;
    }

    const seekTime = project.lastPlaybackTime;
    console.log(`[ProjectDetails] Startup sequence. Seeking to last known time: ${seekTime}`);

    if (seekTime > 0) {
      this.videoStateService.seekAbsolute(seekTime);
    }
  }
}
