import {Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {KeyboardShortcutsService} from './services/keyboard-shortcuts/keyboard-shortcuts.service';
import {SeekDirection, VideoClip} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ActivatedRoute, Router} from '@angular/router';
import {AppStateService} from '../../state/app/app-state.service';
import {ProjectSettingsStateService} from '../../state/project-settings/project-settings-state.service';
import {BuiltInSettingsPresets, HiddenSubtitleStyle, ProjectSettings, SettingsPreset} from '../../model/settings.types';
import {DialogService, DynamicDialogRef} from 'primeng/dynamicdialog';
import {CommandHistoryStateService} from '../../state/command-history/command-history-state.service';
import {EditSubtitlesDialogComponent} from './edit-subtitles-dialog/edit-subtitles-dialog.component';
import {ClipContent, UpdateClipTextCommand} from '../../model/commands/update-clip-text.command';
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
import {ParsedSubtitlesData} from '../../../electron-api';
import {SubtitlesHighlighterService} from './services/subtitles-highlighter/subtitles-highlighter.service';
import {SubtitlesHighlighterComponent} from './subtitles-highlighter/subtitles-highlighter.component';
import {FontInjectionService} from './services/font-injection/font-injection.service';
import {AssSubtitlesUtils} from '../../shared/utils/ass-subtitles/ass-subtitles.utils';
import {AssEditService} from './services/ass-edit/ass-edit.service';

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
    SubtitlesOverlayComponent,
    SubtitlesHighlighterComponent
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss',
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
})
export class ProjectDetailsComponent implements OnInit, OnDestroy {
  protected currentClipHasSubtitles = computed(() => !!this.clipsStateService.currentClip()?.hasSubtitle);

  protected readonly canEditSubtitles = computed(() => {
    const clip = this.clipsStateService.currentClip();
    if (!clip || !clip.hasSubtitle) {
      return false;
    }

    if (!this.isAssProject()) {
      return true; // For SRT always allow editing subtitles
    }

    // For ASS allow editing only when ASS.js renderer is selected:
    return !this.projectSettingsStateService.useMpvSubtitles();
  });

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
  protected readonly project = computed(() => {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (!projectId) {
      return null;
    }
    return this.appStateService.projects().find(p => p.id === projectId) ?? null;
  });
  protected readonly settingsPresets = signal<SettingsPreset[]>(BuiltInSettingsPresets);
  protected readonly selectedSettingsPreset = signal<SettingsPreset | null>(null);

  protected readonly parsedSubtitleData = computed<ParsedSubtitlesData | null>(() => {
    const project = this.project();
    if (!project) {
      return null;
    }

    return {
      subtitles: project.subtitles,
      rawAssContent: project.rawAssContent,
      styles: project.styles
    };
  });

  protected readonly isAssProject = computed(() => Boolean(this.parsedSubtitleData()?.rawAssContent));

  protected readonly scopedAssContent = computed<string | undefined>(() => {
    const project = this.project();
    const currentClip = this.clipsStateService.currentClip();

    if (!project?.rawAssContent || !currentClip?.hasSubtitle) {
      return undefined;
    }

    return AssSubtitlesUtils.scopeAssContent(
      project.rawAssContent,
      currentClip.startTime,
      currentClip.endTime
    ) ?? project.rawAssContent;
  });

  private wasPlayingBeforeSettingsOpened = false;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly appStateService = inject(AppStateService);
  private readonly fontInjectionService = inject(FontInjectionService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private dialogRef: DynamicDialogRef | undefined;
  private isMpvReady = signal(false);
  private isUiReady = signal(false);
  private hasFiredStartupSequence = false;
  private cleanupInitialSeekListener: (() => void) | null = null;

  constructor() {
    inject(KeyboardShortcutsService); // start listening
    inject(SubtitlesHighlighterService); // start listening

    effect(() => {
      const subtitlesVisible = this.videoStateService.subtitlesVisible();
      untracked(() => {
        this.projectSettingsStateService.setSubtitlesVisible(subtitlesVisible);
      });
    });

    effect(() => {
      const currentSettings = this.projectSettingsStateService.settings();
      window.electronAPI.playbackUpdateSettings(currentSettings);
      const currentProject = untracked(this.project);
      if (currentProject) {
        this.appStateService.updateProject(currentProject.id, {settings: currentSettings});
      }
    });

    effect(() => {
      const duration = this.videoStateService.duration();
      const project = untracked(this.project);

      if (project && duration > 0 && project.duration !== duration) {
        this.appStateService.updateProject(project.id, {duration: duration});
      }
    });

    effect(() => {
      const clips = this.clipsStateService.clips();
      // Wait until UI and MPV are ready, and clips have been generated from the video's duration.
      if (this.isUiReady() && this.isMpvReady() && clips.length > 0 && !this.hasFiredStartupSequence) {
        this.hasFiredStartupSequence = true;
        const settings = this.projectSettingsStateService.settings();
        window.electronAPI.playbackLoadProject(clips, settings);
        this.startPlaybackSequence();
      }
    });

    window.electronAPI.onMpvManagerReady(() => {
      console.log('[ProjectDetails] Received mpv:managerReady signal!');
      this.isMpvReady.set(true);
    });
  }

  async ngOnInit() {
    this.videoStateService.setIsBusy(true);

    this.cleanupInitialSeekListener = window.electronAPI.onMpvInitialSeekComplete(() => {
      console.log('[ProjectDetails] Received initial-seek-complete. Hiding spinner.');
      setTimeout(() => this.videoStateService.setIsBusy(false), 25);
    });

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

    // Logic for re-entering the project - the rawAssContent should already exist in this case:
    if (foundProject.rawAssContent) {
      this.loadAndInjectFonts(projectId);
    }

    this.projectSettingsStateService.setSettings(foundProject.settings);
    this.videoStateService.setSubtitlesVisible(foundProject.settings.subtitlesVisible);
    this.appStateService.setCurrentProject(projectId);
    this.clipsStateService.setProjectId(projectId);
    this.videoStateService.setProjectId(projectId);
    this.videoStateService.setMediaPath(foundProject.mediaPath);

    const hasExistingSubtitles = foundProject?.subtitles?.length > 0;
    let subtitles: SubtitleData[];

    if (hasExistingSubtitles) {
      subtitles = foundProject.subtitles;
    } else {
      try {
        let subtitleResult: ParsedSubtitlesData;

        switch (foundProject.subtitleSelection.type) {
          case 'external':
            subtitleResult = await window.electronAPI.parseSubtitleFile(projectId, foundProject.subtitleSelection.filePath);
            break;
          case 'embedded':
            subtitleResult = await window.electronAPI.extractSubtitleTrack(projectId, foundProject.mediaPath, foundProject.subtitleSelection.trackIndex);
            break;
          case 'none':
            subtitleResult = {
              subtitles: []
            };
            break;
        }

        this.appStateService.updateProject(projectId, {
          rawAssContent: subtitleResult.rawAssContent,
          styles: subtitleResult.styles,
          subtitles: subtitleResult.subtitles,
        });

        if (subtitleResult.rawAssContent) {
          this.loadAndInjectFonts(projectId);
        }

        subtitles = subtitleResult.subtitles;
      } catch (e: any) {
        this.toastService.error(`Failed to load subtitles: ${e.message}`);
        subtitles = [];
      }
    }

    this.clipsStateService.setSubtitles(subtitles);
    await window.electronAPI.mpvCreateViewport(
      foundProject.mediaPath,
      foundProject.settings.selectedAudioTrackIndex,
      foundProject.subtitleSelection,
      foundProject.subtitleTracks,
      foundProject.settings.useMpvSubtitles,
      foundProject.settings.subtitlesVisible
    );
  }

  ngOnDestroy(): void {
    if (this.cleanupInitialSeekListener) {
      this.cleanupInitialSeekListener();
    }
    this.fontInjectionService.clearFonts();
    window.electronAPI.mpvHideSubtitles();
    window.electronAPI.onMpvDestroyViewport();
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

    const subtitleForExport: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

    const hasValidTemplates = this.ankiStateService.ankiCardTemplates().some(t => t.isValid);
    if (!hasValidTemplates) {
      this.toastService.warn('Please configure at least one valid Anki template in the global settings.');
      return;
    }

    const data: ExportToAnkiDialogData = {
      subtitleData: subtitleForExport,
      project: this.project()!,
      exportTime: this.videoStateService.currentTime()
    };

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
    if (!this.canEditSubtitles()) {
      this.toastService.info('Subtitle editing is only available in the "Interactive (ASS.js)" renderer mode.');
      return;
    }

    const currentClip = this.clipsStateService.currentClip();
    if (!currentClip || !currentClip.hasSubtitle) {
      return;
    }

    const dataForDialog: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

    this.dialogRef = this.dialogService.open(EditSubtitlesDialogComponent, {
      header: 'Edit Subtitles',
      width: '50vw',
      modal: true,
      data: dataForDialog
    });

    this.dialogRef.onClose.pipe(
      take(1)
    ).subscribe((result: ClipContent | undefined) => {
      if (!result) return; // Closed without saving or no changes were made

      const oldContent: ClipContent = {
        text: currentClip.text,
        parts: currentClip.parts
      };

      const newContent: ClipContent = {
        text: result.text,
        parts: result.parts
      };

      const command = new UpdateClipTextCommand(
        this.clipsStateService,
        this.project()!.id,
        currentClip.id,
        oldContent,
        newContent
      );

      this.commandHistoryStateService.execute(command);
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
      this.videoStateService.setIsBusy(false);
      return;
    }

    const duration = this.videoStateService.duration();
    if (duration <= 0) {
      this.videoStateService.setIsBusy(false);
      return;
    }

    const seekTime = project.lastPlaybackTime;
    console.log(`[ProjectDetails] Startup sequence. Seeking to last known time: ${seekTime}`);

    const clips = this.clipsStateService.clips();
    const targetClipIndex = clips.findIndex(c => seekTime >= c.startTime && seekTime < c.endTime);
    if (targetClipIndex !== -1) {
      this.clipsStateService.setCurrentClipByIndex(targetClipIndex);
      console.log(`[ProjectDetails] Synchronized active clip to index: ${targetClipIndex} `);
    }

    this.videoStateService.setCurrentTime(seekTime);
    window.electronAPI.playbackSeek(seekTime);
    this.videoStateService.finishInitialization();
  }

  private loadAndInjectFonts(projectId: string): void {
    window.electronAPI.getProjectFonts(projectId).then(fonts => {
      if (fonts && fonts.length > 0) {
        this.fontInjectionService.injectFontsIntoDOM(fonts);
      }
    });
  }

  private createSubtitleDataFromVideoClip(clip: VideoClip): SubtitleData {
    if (this.isAssProject()) {
      return {
        type: 'ass',
        id: clip.id,
        startTime: clip.startTime,
        endTime: clip.endTime,
        parts: clip.parts
      };
    } else { // srt
      return {
        type: 'srt',
        id: clip.id,
        startTime: clip.startTime,
        endTime: clip.endTime,
        text: clip.text || ''
      };
    }
  }
}
