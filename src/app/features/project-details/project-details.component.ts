import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {
  ProjectKeyboardShortcutsService
} from './services/project-keyboard-shortcuts/project-keyboard-shortcuts.service';
import {KeyboardAction, mapVideoClipToLightweight, VideoClip} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ActivatedRoute, Router} from '@angular/router';
import {AppStateService} from '../../state/app/app-state.service';
import {ProjectSettingsStateService} from '../../state/project-settings/project-settings-state.service';
import {LookupType, SubtitleLookupBrowserType, SubtitleLookupService} from '../../model/settings.types';
import {DialogService, DynamicDialogRef} from 'primeng/dynamicdialog';
import {CommandHistoryStateService} from '../../state/command-history/command-history-state.service';
import {EditSubtitlesDialogComponent} from './edit-subtitles-dialog/edit-subtitles-dialog.component';
import {ClipContent, UpdateClipTextCommand} from '../../model/commands/update-clip-text.command';
import {take} from 'rxjs';
import {ToastService} from '../../shared/services/toast/toast.service';
import type {DialogSubtitlePart, SubtitleData} from '../../../../shared/types/subtitle.type';
import {Dropdown, DropdownModule} from 'primeng/dropdown';
import {FormsModule} from '@angular/forms';
import {AnkiStateService} from '../../state/anki/anki-state.service';
import {ExportToAnkiDialogComponent} from './export-to-anki-dialog/export-to-anki-dialog.component';
import {AnkiConnectStatus, ExportToAnkiDialogData} from '../../model/anki.types';
import {CurrentProjectSettingsComponent} from './current-project-settings/current-project-settings.component';
import {SubtitlesOverlayComponent} from './subtitles-overlay/subtitles-overlay.component';
import {ParsedSubtitlesData} from '../../../electron-api';
import {SubtitlesHighlighterService} from './services/subtitles-highlighter/subtitles-highlighter.service';
import {SubtitlesHighlighterComponent} from './subtitles-highlighter/subtitles-highlighter.component';
import {FontInjectionService} from './services/font-injection/font-injection.service';
import {AssEditService} from './services/ass-edit/ass-edit.service';
import {TokenizationService} from './services/tokenization/tokenization.service';
import {ContextMenu} from 'primeng/contextmenu';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {MenuItem} from 'primeng/api';
import {DialogOrchestrationService} from '../../core/services/dialog-orchestration/dialog-orchestration.service';
import {cloneDeep} from 'lodash-es';
import {GlobalSettingsTab} from '../global-settings-dialog/global-settings-dialog.types';
import {ProjectActionService} from './services/project-action/project-action.service';
import {
  HeaderCurrentProjectActionBridgeService
} from '../../core/services/header-current-project-action-bridge/header-current-project-action-bridge.service';
import {DatePipe} from '@angular/common';
import {AssSubtitlesUtils} from '../../../../shared/utils/ass-subtitles.utils';
import {Project} from '../../model/project.types';
import {OverlayBadgeModule} from 'primeng/overlaybadge';
import {MediaTrack} from '../../../../shared/types/media.type';
import {YomitanService} from '../../core/services/yomitan/yomitan.service';
import {NoteRequest} from './subtitles-overlay/subtitles-overlay.types';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {NoteFormDialogData, NoteFormResult} from './note-form-dialog/note-form-dialog.types';
import {NoteFormDialogComponent} from './note-form-dialog/note-form-dialog.component';
import {ProjectNotesComponent} from './project-notes/project-notes.component';
import {SearchSubtitlesDialogComponent} from './search-subtitles-dialog/search-subtitles-dialog.component';
import {SearchSubtitlesDialogData} from './search-subtitles-dialog/search-subtitles-dialog.types';
import {SubtitleOffsetDialogComponent} from './subtitle-offset-dialog/subtitle-offset-dialog.component';
import {SubtitleOffsetDialogData} from './subtitle-offset-dialog/subtitle-offset-dialog.types';
import {SubtitlesLookupStateService} from './services/subtitles-lookup-state/subtitles-lookup-state.service';

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
    SubtitlesHighlighterComponent,
    ContextMenu,
    DatePipe,
    OverlayBadgeModule,
    ProjectNotesComponent
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss',
  providers: [
    ProjectActionService,
    ProjectKeyboardShortcutsService,
    SubtitlesHighlighterService,
    ClipsStateService,
    CommandHistoryStateService,
    ProjectSettingsStateService,
    VideoStateService,
    FontInjectionService,
    AssEditService,
    TokenizationService,
    SubtitlesLookupStateService
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProjectDetailsComponent implements OnInit, OnDestroy {
  protected readonly isYomitanEnabled = signal(false);
  protected readonly subtitlesAtCurrentTime = computed(() => this.clipsStateService.subtitlesAtCurrentTime());

  protected readonly trackIndexes = computed(() => {
    const count = this.clipsStateService.totalTracks();
    return Array.from({length: count}, (_, i) => i);
  });

  protected readonly trackHasContent = computed(() => {
    const activeTrack = this.clipsStateService.activeTrack();
    const activeSubs = this.subtitlesAtCurrentTime();
    const trackBooleans = Array(this.clipsStateService.totalTracks()).fill(false);

    for (const sub of activeSubs) {
      if (sub.track !== activeTrack) {
        trackBooleans[sub.track] = true;
      }
    }
    return trackBooleans;
  });

  protected readonly hasParallelClipsAtCurrentTime = computed(() => {
    const activeSubtitles = this.clipsStateService.subtitlesAtCurrentTime();

    if (activeSubtitles.length < 2) {
      return false;
    }

    const activeTracks = new Set(activeSubtitles.map(sub => sub.track));
    return activeTracks.size >= 2;
  });

  protected readonly trackDropdownTooltip = computed(() => {
    if (this.hasParallelClipsAtCurrentTime()) {
      return 'Parallel Subtitles Available';
    } else {
      return 'Switch Subtitles Track';
    }
  });

  protected readonly trackOptions = computed(() => {
    const indexes = this.trackIndexes();
    const content = this.trackHasContent();
    return indexes.map(i => ({
      label: `Track ${i + 1}`,
      value: i,
      hasContent: content[i]
    }));
  });

  protected readonly hasNotesForCurrentClip = computed(() => {
    const project = this.project();
    const currentClip = this.clipsStateService.currentClipForAllTracks();

    if (!project || !currentClip || !currentClip.hasSubtitle) {
      return false;
    }

    const clipId = currentClip.sourceSubtitles[0]?.id;
    if (!clipId) {
      return false;
    }

    const notes = project.notes?.[clipId];
    if (!notes) {
      return false;
    }

    const hasManualNote = Boolean(notes.manualNote && notes.manualNote.trim().length > 0);
    const hasLookupNotes = notes.lookupNotes && Object.values(notes.lookupNotes).some(list => list.length > 0);

    return hasManualNote || hasLookupNotes;
  });

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
    return this.clipsStateService.masterClipIndex() <= 0;
  });

  protected isLastClip = computed(() => {
    const clips = this.clipsStateService.clipsForAllTracks();
    if (clips.length === 0) {
      return true;
    }

    return this.clipsStateService.masterClipIndex() >= (clips.length - 1);
  });

  protected isGoToPreviousSubtitledClipActionDisabled = computed(() => {
    const allClips = this.clipsStateService.clipsForAllTracks();
    const currentIndex = this.clipsStateService.masterClipIndex();
    const currentClip = this.clipsStateService.currentClipForAllTracks();

    if (!currentClip) {
      return true;
    }

    const previousSubtitledClipExists = allClips.some((clip, index) => (index < currentIndex) && clip.hasSubtitle);
    if (previousSubtitledClipExists) {
      return false;
    }

    return !currentClip.hasSubtitle;
  });

  protected isGoToNextSubtitledClipActionDisabled = computed(() => {
    const allClips = this.clipsStateService.clipsForAllTracks();
    const currentIndex = this.clipsStateService.masterClipIndex();
    const nextSubtitledClipExists = allClips.some((clip, index) => (index > currentIndex) && clip.hasSubtitle);
    return !nextSubtitledClipExists;
  });

  protected interactionBlockerTooltipText = computed(() => {
    if (!this.videoStateService.isBusy()) {
      return undefined;
    }

    const thingsBeingLoaded: string[] = [];

    if (this.videoStateService.isVideoLoading()) {
      thingsBeingLoaded.push('the video');
    }

    if (this.videoStateService.isTimelineLoading()) {
      thingsBeingLoaded.push('the timeline');
    }

    return `Please wait for ${thingsBeingLoaded.join(' and ')} to finish loading`;
  });

  protected readonly commandHistoryStateService = inject(CommandHistoryStateService);
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly ankiStateService = inject(AnkiStateService);
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  protected readonly subtitlesLookupStateService = inject(SubtitlesLookupStateService);
  protected readonly project = computed(() => {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (!projectId || this.appStateService.currentProjectId() !== projectId) {
      return null;
    }
    return this.appStateService.currentProject();
  });

  protected readonly parsedSubtitleData = computed<ParsedSubtitlesData | null>(() => {
    const project = this.project();
    if (!project) {
      return null;
    }

    return {
      subtitles: project.subtitles,
      rawAssContent: project.rawAssContent,
      styles: project.styles,
      detectedLanguage: project.detectedLanguage
    };
  });

  protected readonly isAssProject = computed(() => Boolean(this.parsedSubtitleData()?.rawAssContent));

  protected readonly scopedAssContent = computed<string | undefined>(() => {
    const project = this.project();
    const currentClip = this.clipsStateService.currentClipForAllTracks();

    if (!project?.rawAssContent || !currentClip?.hasSubtitle) {
      return undefined;
    }

    return AssSubtitlesUtils.scopeAssContent(
      project.rawAssContent,
      currentClip.startTime,
      currentClip.endTime
    ) ?? project.rawAssContent;
  });

  protected readonly subtitlesContextMenu = viewChild.required<ContextMenu>('subtitlesContextMenu');
  protected readonly timelineContextMenu = viewChild.required<ContextMenu>('timelineContextMenu');
  protected readonly timelineEditor = viewChild.required<TimelineEditorComponent>('timelineEditor');
  protected readonly tracksDropdown = viewChild<Dropdown>('tracksDropdown');
  protected readonly isTrackTooltipDisabled = signal(false);
  protected readonly subtitlesMenuItems = signal<MenuItem[]>([]);
  protected readonly timelineMenuItems = signal<MenuItem[]>([]);
  protected readonly isSubtitlesContextMenuOpen = signal(false);
  protected readonly isTimelineContextMenuOpen = signal(false);
  protected readonly isAnyContextMenuOpen = computed(() =>
    this.isSubtitlesContextMenuOpen() || this.isTimelineContextMenuOpen()
  );

  private readonly subtitlesOverlay = viewChild.required(SubtitlesOverlayComponent);
  private selectedSubtitleTextForMenu = '';
  private wasPlayingBeforeSettingsOpened = false;
  private wasSettingsDrawerOpened = false;
  private readonly actionService = inject(ProjectActionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly appStateService = inject(AppStateService);
  private readonly fontInjectionService = inject(FontInjectionService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private readonly headerCurrentProjectActionBridgeService = inject(HeaderCurrentProjectActionBridgeService);
  private readonly yomitanService = inject(YomitanService);
  private activeDialogRef: DynamicDialogRef | null = null;
  private isMpvReady = signal(false);
  private isUiReady = signal(false);
  private hasFiredStartupSequence = false;
  private hasSetInitialClip = false;
  private cleanupInitialSeekListener: (() => void) | null = null;
  private cleanupMpvReadyListener: (() => void) | null = null;
  private cleanupAddNoteListener: (() => void) | null = null;
  private clickTimeout: any = null;
  private lastSubtitledClipId: string | null = null;

  constructor() {
    inject(ProjectKeyboardShortcutsService); // start listening
    inject(TokenizationService); // start listening
    this.headerCurrentProjectActionBridgeService.register(
      this.commandHistoryStateService,
      this.actionService
    );

    effect(() => {
      const subtitlesVisible = this.videoStateService.subtitlesVisible();
      untracked(() => {
        this.projectSettingsStateService.setSubtitlesVisible(subtitlesVisible);
      });
    });

    effect(() => {
      const currentSettings = this.projectSettingsStateService.settings();
      window.electronAPI.playbackUpdateSettings(currentSettings);
    });

    effect(() => {
      const duration = this.videoStateService.duration();
      const project = untracked(this.project);

      if (project && duration > 0 && project.duration !== duration) {
        this.appStateService.updatePartialProject(project.id, {duration: duration});
      }
    });

    effect(() => {
      const project = this.project();
      const allClips = this.clipsStateService.clipsForAllTracks();

      if (allClips.length > 0 && project && !this.hasSetInitialClip) {
        const initialClipIndex = allClips.findIndex(
          c => project.lastPlaybackTime >= c.startTime && project.lastPlaybackTime < c.endTime
        );

        if (initialClipIndex !== -1) {
          this.clipsStateService.setCurrentClipByIndex(initialClipIndex);
          this.hasSetInitialClip = true;
        }
      }

      if (this.isUiReady() && this.isMpvReady() && allClips.length > 0 && !this.hasFiredStartupSequence && project) {
        this.hasFiredStartupSequence = true;
        const settings = this.projectSettingsStateService.settings();
        const lightweightClips = allClips.map((clip: VideoClip) => mapVideoClipToLightweight(clip));
        window.electronAPI.playbackLoadProject(lightweightClips, settings, project.lastPlaybackTime);
        this.startPlaybackSequence();
      }
    });

    effect(() => {
      if (!this.videoStateService.isPaused()) {
        this.timelineContextMenu().hide();
        this.subtitlesContextMenu().hide();
      }
    });

    effect(() => {
      const language = this.projectSettingsStateService.subtitlesLanguage();
      this.globalSettingsStateService.settingsReloadTrigger();

      // Ensure languages are loaded before trying to sync
      this.yomitanService.ensureLanguagesLoaded().then(() => {
        // Update Yomitan and re-check for valid dictionaries
        this.initializeYomitan(language);
      });
    });

    effect(() => {
      if (this.videoStateService.findInSubtitlesRequest()) {
        untracked(() => {
          this.openFindSubtitlesDialog();
        });
        this.videoStateService.clearFindInSubtitlesRequest();
      }
    });

    effect(() => {
      const useHwDec = this.globalSettingsStateService.hardwareAcceleration();
      if (this.isMpvReady()) {
        window.electronAPI.mpvSetProperty('hwdec', useHwDec ? 'auto' : 'no');
      }
    });

    effect(() => {
      const currentClip = this.clipsStateService.currentClipForAllTracks();
      const project = this.project();
      const warnEnabled = this.globalSettingsStateService.warnUnexportedNotes();

      if (!project || !currentClip) {
        return;
      }

      untracked(() => {
        const currentSourceId = currentClip.hasSubtitle ? currentClip.sourceSubtitles[0]?.id : null;

        if (this.lastSubtitledClipId && this.lastSubtitledClipId !== currentSourceId && warnEnabled) {
          const notes = project.notes?.[this.lastSubtitledClipId];

          let hasNotes = false;
          if (notes) {
            const hasManualNote = Boolean(notes.manualNote && notes.manualNote.trim().length > 0);
            const hasLookupNotes = Boolean(notes.lookupNotes && Object.values(notes.lookupNotes).some(list => list.length > 0));
            hasNotes = hasManualNote || hasLookupNotes;
          }

          const isExported = project.ankiExportHistory?.includes(this.lastSubtitledClipId);

          if (hasNotes && !isExported) {
            this.toastService.warn('You moved past a clip with notes without exporting it to Anki');
          }
        }

        if (currentClip.hasSubtitle) {
          this.lastSubtitledClipId = currentSourceId;
        }
      });
    });

    this.cleanupMpvReadyListener = window.electronAPI.onMpvManagerReady(() => {
      console.log('[ProjectDetails] Received mpv:managerReady signal!');
      this.isMpvReady.set(true);
    });

    this.headerCurrentProjectActionBridgeService.registerOffsetDialogOpener(() => this.openSubtitleOffsetDialog());
  }

  async ngOnInit() {
    const foundProject = this.route.snapshot.data['project'] as Project;
    const projectId = foundProject.id;
    this.videoStateService.setVideoLoading(true);

    this.cleanupInitialSeekListener = window.electronAPI.onMpvInitialSeekComplete(() => {
      console.log('[ProjectDetails] Received initial-seek-complete. Hiding spinner.');
      setTimeout(() => this.videoStateService.setVideoLoading(false), 25);
    });

    this.cleanupAddNoteListener = window.electronAPI.onProjectAddNote((note) => {
      this.addNoteToProject(note.clipSubtitleId, note.selection, note.text);
    });

    // Set the initial playback time immediately to prevent the timeline from defaulting to 0
    this.videoStateService.setCurrentTime(foundProject.lastPlaybackTime);

    // Logic for re-entering the project - the rawAssContent should already exist in this case:
    if (foundProject.rawAssContent) {
      this.loadAndInjectFonts(projectId);
    }

    if (this.globalSettingsStateService.generateAudioPeaks() && !foundProject.audioPeaks) {
      this.videoStateService.setTimelineLoading(true);
      this.generateAudioPeaksInBackground(projectId, foundProject.mediaPath);
    }

    this.videoStateService.setSubtitlesVisible(foundProject.settings.subtitlesVisible);
    this.clipsStateService.setProjectId(projectId);
    this.videoStateService.setProjectId(projectId);
    this.videoStateService.setMediaPath(foundProject.mediaPath);

    const hasExistingSubtitles = foundProject.subtitles?.length > 0;
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
              subtitles: [],
              detectedLanguage: 'other'
            };
            break;
        }

        this.appStateService.updatePartialProject(projectId, {
          rawAssContent: subtitleResult.rawAssContent,
          styles: subtitleResult.styles,
          subtitles: subtitleResult.subtitles,
          detectedLanguage: subtitleResult.detectedLanguage,
          lastSubtitleEndTime: Math.max(...subtitleResult.subtitles.map(s => s.endTime), 0),
          settings: {
            ...foundProject.settings,
            subtitlesLanguage: subtitleResult.detectedLanguage,
          }
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

    // Map absolute stream index to MPV relative audio track ID
    const audioTrackId = this.getMpvAudioTrackId(foundProject.audioTracks, foundProject.settings.selectedAudioTrackIndex);
    const hardwareAcceleration = this.globalSettingsStateService.hardwareAcceleration();

    try {
      await window.electronAPI.mpvCreateViewport(
        foundProject.mediaPath,
        audioTrackId,
        foundProject.subtitleSelection,
        foundProject.subtitleTracks,
        foundProject.settings.useMpvSubtitles,
        foundProject.settings.subtitlesVisible,
        hardwareAcceleration
      );
    } catch (e: any) {
      console.error('MPV failed to initialize unexpectedly', e);
      this.toastService.error(`The media player failed to start: ${e.message || 'The file may be corrupt or unsupported'}`);
      this.videoStateService.setVideoLoading(false);
      this.router.navigate(['/projects']);
    }
  }

  ngOnDestroy(): void {
    this.activeDialogRef?.close();
    if (this.cleanupMpvReadyListener) {
      this.cleanupMpvReadyListener();
    }
    if (this.cleanupInitialSeekListener) {
      this.cleanupInitialSeekListener();
    }
    if (this.cleanupAddNoteListener) {
      this.cleanupAddNoteListener();
    }
    this.fontInjectionService.clearFonts();
    this.headerCurrentProjectActionBridgeService.clear();
    this.toastService.setPosition('top-right');
  }

  async canDeactivate(): Promise<boolean> {
    console.log('[ProjectDetails] Navigation detected. Starting cleanup sequence...');

    try {
      // Force save the current state while the project ID is still valid
      await this.videoStateService.performCleanup();

      // Hide subtitles just in case
      await window.electronAPI.mpvHideSubtitles();

      // Tell Electron to destroy MPV and WAIT for it to finish.
      // This ensures the old mpv.exe process is dead before the new component asks for a new one.
      await window.electronAPI.onMpvDestroyViewport();

      console.log('[ProjectDetails] Cleanup complete. Allowing navigation.');
      return true;
    } catch (e) {
      console.error('[ProjectDetails] Cleanup failed', e);
      return true; // Allow navigation anyway to prevent getting stuck
    }
  }

  onLookupBackdropClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.subtitlesLookupStateService.closeLookup();
  }

  onPlayerReady(): void {
    console.log('[ProjectDetails] Received onPlayerReady signal from UI!');
    this.isUiReady.set(true);
  }

  goToNextSubtitledClip() {
    this.actionService.dispatch(KeyboardAction.NextSubtitledClip);
  }

  goToPreviousSubtitledClip() {
    this.actionService.dispatch(KeyboardAction.PreviousSubtitledClip);
  }

  togglePlayPause() {
    this.actionService.dispatch(KeyboardAction.TogglePlayPause);
  }

  repeatCurrentClip() {
    this.actionService.dispatch(KeyboardAction.RepeatCurrentClip);
  }

  adjustClipStartLeft(): void {
    this.actionService.dispatch(KeyboardAction.AdjustClipStartLeft);
  }

  adjustClipStartRight(): void {
    this.actionService.dispatch(KeyboardAction.AdjustClipStartRight);
  }

  adjustClipEndLeft(): void {
    this.actionService.dispatch(KeyboardAction.AdjustClipEndLeft);
  }

  adjustClipEndRight(): void {
    this.actionService.dispatch(KeyboardAction.AdjustClipEndRight);
  }

  toggleSettings(): void {
    this.actionService.dispatch(KeyboardAction.ToggleSettings);
  }

  toggleNotes(): void {
    this.actionService.dispatch(KeyboardAction.ToggleNotes);
  }

  deleteCurrentClip(): void {
    this.actionService.dispatch(KeyboardAction.DeleteClip);
  }

  splitCurrentSubtitledClip(): void {
    this.actionService.dispatch(KeyboardAction.SplitClip);
  }

  createNewSubtitledClipAtCurrentTime(): void {
    this.actionService.dispatch(KeyboardAction.CreateClip);
  }

  toggleSubtitlesVisible(): void {
    this.actionService.dispatch(KeyboardAction.ToggleSubtitles);
  }

  openEditSubtitlesDialog(): void {
    this.actionService.dispatch(KeyboardAction.EditCurrentSubtitles);
  }

  undo(): void {
    this.actionService.dispatch(KeyboardAction.Undo);
  }

  redo(): void {
    this.actionService.dispatch(KeyboardAction.Redo);
  }

  async openAnkiExportDialog(instantExport: boolean): Promise<void> {
    this.subtitlesOverlay().clearHighlightAndPopup();

    if (!this.ankiStateService.isAnkiExportAvailable()) {
      this.toastService.error('Anki export is not available. FFmpeg could not be found.');
      return;
    }

    await this.ankiStateService.checkAnkiConnection();

    if (this.ankiStateService.status() !== AnkiConnectStatus.connected) {
      this.toastService.error('Failed to connect. Is Anki open?');
      return;
    }

    const currentClip = this.clipsStateService.currentClipForAllTracks();
    if (!currentClip || !currentClip.hasSubtitle) {
      this.toastService.info('Anki export is only available for subtitled clips');
      return;
    }

    const subtitleForExport: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

    const data: ExportToAnkiDialogData = {
      subtitleData: subtitleForExport,
      project: this.project()!,
      exportTime: this.videoStateService.currentTime(),
      instantExport
    };

    const dialogRef = this.dialogService.open(ExportToAnkiDialogComponent, {
      width: 'clamp(20rem, 95vw, 45rem)',
      style: {
        'max-height': '90vh'
      },
      contentStyle: {
        'padding': '0',
        'display': 'flex',
        'flex-direction': 'column',
        'overflow': 'hidden'
      },
      focusOnShow: false,
      modal: true,
      closable: false,
      closeOnEscape: false,
      showHeader: false,
      styleClass: instantExport ? 'instant-anki-export-hidden' : undefined,
      data
    });

    this.watchDialogPlaybackState(dialogRef);
  }

  onAnkiTagsChange(ankiTags: string[]) {
    const project = this.project();
    if (project) {
      this.appStateService.updatePartialProject(project.id, {ankiTags});
    }
  }

  onVideoAreaClick(): void {
    if (this.isAnyContextMenuOpen()) {
      this.hideAllContextMenus();
      return;
    }

    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
      window.electronAPI.windowHandleDoubleClick();
    } else {
      this.clickTimeout = setTimeout(() => {
        this.togglePlayPause();
        this.clickTimeout = null;
      }, 200);
    }
  }

  protected onTrackChange(trackIndex: number): void {
    this.clipsStateService.setActiveTrack(trackIndex);
    this.isTrackTooltipDisabled.set(true);

    setTimeout(() => {
      const dropdownNativeEl = this.tracksDropdown()?.el?.nativeElement;
      if (dropdownNativeEl?.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
        this.isTrackTooltipDisabled.set(false);
      }
    });
  }

  protected hideAllContextMenus(): void {
    this.timelineContextMenu()?.hide();
    this.subtitlesContextMenu()?.hide();
  }

  onSubtitlesContextMenu(payload: { event: MouseEvent, text: string }): void {
    this.timelineContextMenu().hide();

    if (this.isSubtitlesContextMenuOpen()) {
      return;
    }

    this.subtitlesHighlighterService.hide();
    this.isSubtitlesContextMenuOpen.set(true);
    this.selectedSubtitleTextForMenu = payload.text;

    const projectSettings = this.projectSettingsStateService.settings();
    const allServices = this.globalSettingsStateService.subtitleLookupServices();

    let effectiveDefaultServiceId: string | null = null;
    if (projectSettings.defaultSubtitleLookupServiceId) {
      effectiveDefaultServiceId = projectSettings.defaultSubtitleLookupServiceId;
    } else {
      const globalDefault = allServices.find(s => s.isDefault);
      if (globalDefault) {
        effectiveDefaultServiceId = globalDefault.id;
      }
    }

    const menuItems: MenuItem[] = [
      {
        label: `Selected text: "${payload.text}"`,
        disabled: true,
        styleClass: 'context-menu-selected-text'
      },
      {
        separator: true
      }
    ];

    allServices.forEach((service: SubtitleLookupService) => {
      const isDefault = (service.id === effectiveDefaultServiceId);
      const type: LookupType = (service.type || 'search');
      const menuItem: MenuItem = {
        label: service.name,
        icon: (type === 'search') ? 'fa-solid fa-globe' : 'fa-solid fa-microchip',
        badge: isDefault ? 'Default' : undefined,
        badgeStyleClass: 'default-lookup-service-badge',
        command: () => this.executeLookup(service, this.selectedSubtitleTextForMenu)
      };

      menuItems.push(menuItem);
    });

    menuItems.push({separator: true});

    menuItems.push({
      label: 'Add manual note',
      icon: 'fa-solid fa-note-sticky',
      command: () => this.openNoteDialog(payload.text, '', false)
    });

    if (this.isYomitanEnabled()) {
      menuItems.push({
        label: `Search in offline dictionary`,
        icon: 'fa-solid fa-book',
        command: () => {
          this.subtitlesOverlay().showOfflinePopupFor(this.selectedSubtitleTextForMenu, payload.event);
        }
      });
    }

    menuItems.push(
      {
        label: 'Copy to clipboard',
        icon: 'fa-solid fa-copy',
        command: () => {
          navigator.clipboard.writeText(this.selectedSubtitleTextForMenu);
          this.toastService.success('Copied to clipboard!');
        }
      },
      {
        label: 'Configure online lookup services',
        icon: 'fa-solid fa-cog',
        command: () => this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.OnlineLookups)
      }
    );

    this.subtitlesMenuItems.set(menuItems);
    this.subtitlesContextMenu().show(payload.event);
  }

  onSubtitlesContextMenuHide(): void {
    this.isSubtitlesContextMenuOpen.set(false);
  }

  onTimelineContextMenuHide(): void {
    this.isTimelineContextMenuOpen.set(false);
    // Re-enable WaveSurfer's auto-scrolling for normal behavior once the menu is closed
    this.timelineEditor().setAutoScroll(true);
  }

  onSubtitlePopupShown(): void {
    this.timelineContextMenu().hide();
  }

  onTimelineContextMenu(payload: { event: MouseEvent, clipId: string }): void {
    this.subtitlesContextMenu().hide();

    // Ensure any open offline popup is closed when interacting with the timeline
    this.subtitlesOverlay().clearHighlightAndPopup();

    // Disable WaveSurfer's auto-scrolling to prevent the race condition with the menu
    this.timelineEditor().setAutoScroll(false);

    const clip = this.clipsStateService.clips().find(c => c.id === payload.clipId);
    if (!clip) {
      return;
    }

    const items: MenuItem[] = [];

    // Header (Clip Type)
    items.push({
      label: clip.hasSubtitle ? 'Subtitled Clip' : 'Gap',
      disabled: true,
      styleClass: 'opacity-100 font-bold text-primary'
    });

    items.push({separator: true});

    if (clip.hasSubtitle) {
      const clipText = this.isAssProject()
        ? clip.parts.map(p => p.text).join('\n')
        : clip.text || '';

      if (clipText) {
        items.push({
          label: `"${clipText}"`,
          disabled: true,
          styleClass: 'context-menu-subtitle-text'
        });

        items.push({separator: true});
      }
    }

    // Duration Info
    items.push({
      label: `Duration: ${clip.duration.toFixed(2)}s`,
      icon: 'fa-solid fa-clock',
      disabled: true,
      styleClass: 'opacity-70'
    });

    if (clip.hasSubtitle) {
      const project = this.project();
      if (project) {
        const subtitleId = clip.sourceSubtitles[0]?.id;
        const clipNotes = project.notes?.[subtitleId];

        // Calculate total notes (lookup notes + legacy manual note)
        let totalNotesCount = 0;

        if (clipNotes?.lookupNotes) {
          totalNotesCount += Object.values(clipNotes.lookupNotes).reduce((acc, notes) => acc + notes.length, 0);
        }

        // Include legacy manual note in the total count if present
        if (clipNotes?.manualNote?.trim()) {
          totalNotesCount++;
        }

        const notesText = (totalNotesCount === 1) ? 'note' : 'notes';

        items.push({
          label: `${totalNotesCount} ${notesText}`,
          icon: 'fa-solid fa-clipboard-list',
          disabled: true,
          styleClass: 'opacity-70'
        });

        // Anki Export Status
        const isExported = project.ankiExportHistory?.includes(subtitleId);
        items.push({
          label: isExported ? 'Exported to Anki' : 'Not exported to Anki',
          icon: isExported ? 'fa-solid fa-check text-green-500' : 'fa-solid fa-xmark',
          disabled: true,
          styleClass: 'opacity-70'
        });
      }

      items.push({separator: true});

      // Actions for Subtitled Clip
      items.push(
        {
          label: 'Edit subtitles',
          icon: 'fa-solid fa-file-pen',
          disabled: (this.isAssProject() && this.projectSettingsStateService.useMpvSubtitles()),
          command: () => this.openEditSubtitlesDialog()
        },
        {
          label: 'Export to Anki',
          icon: 'fa-solid fa-e',
          disabled: !this.ankiStateService.isAnkiExportAvailable(),
          command: () => {
            const isInstant = this.globalSettingsStateService.ankiInstantExport();
            this.openAnkiExportDialog(isInstant);
          }
        },
        {
          label: 'Add manual note',
          icon: 'fa-solid fa-note-sticky',
          command: () => this.openNoteDialog('', '', true)
        },
        {
          label: 'Split clip',
          icon: 'fa-solid fa-divide',
          command: () => this.splitCurrentSubtitledClip()
        },
        {
          label: 'Delete clip',
          icon: 'fa-solid fa-eraser',
          command: () => this.deleteCurrentClip()
        }
      );
    } else {
      // Actions for Gap
      items.push({separator: true});
      items.push({
        label: 'Create subtitled clip here',
        icon: 'fa-regular fa-square-plus',
        command: () => this.createNewSubtitledClipAtCurrentTime()
      });

      const clips = this.clipsStateService.clips();
      const index = clips.findIndex(c => c.id === clip.id);
      const prev = clips[index - 1];
      const next = clips[index + 1];
      const hasNeighbors = prev && next && prev.hasSubtitle && next.hasSubtitle;

      items.push({
        label: 'Merge adjacent subtitles',
        icon: 'fa-solid fa-compress',
        disabled: !hasNeighbors || this.isAssProject(),
        command: () => this.actionService.dispatch(KeyboardAction.MergeSubtitles)
      });

      items.push({
        label: 'Remove gap',
        icon: 'fa-solid fa-eraser',
        disabled: !hasNeighbors,
        command: () => this.deleteCurrentClip()
      });
    }

    this.timelineMenuItems.set(items);
    this.timelineContextMenu().show(payload.event);
    this.isTimelineContextMenuOpen.set(true);

    // Reposition menu after it renders to prevent being cut off
    setTimeout(() => {
      const menuEl = this.timelineContextMenu().container;
      if (menuEl) {
        const menuHeight = menuEl.offsetHeight;
        let newTop = payload.event.clientY - menuHeight;
        let newLeft = payload.event.clientX;

        if (newTop < 0) newTop = 5;
        const menuWidth = menuEl.offsetWidth;
        if (newLeft + menuWidth > window.innerWidth) {
          newLeft = window.innerWidth - menuWidth - 5;
        }

        menuEl.style.top = `${newTop}px`;
        menuEl.style.left = `${newLeft}px`;
      }
    }, 10);
  }

  onAddNoteRequest(request: NoteRequest) {
    const currentClip = this.clipsStateService.currentClipForAllTracks();
    if (currentClip && currentClip.sourceSubtitles[0]) {
      this.addNoteToProject(
        currentClip.sourceSubtitles[0].id,
        request.term,
        request.text
      );
      this.toastService.success('Note added!');
    }
  }

  onDefaultAction(text: string): void {
    const projectSettings = this.projectSettingsStateService.settings();
    const allServices = this.globalSettingsStateService.subtitleLookupServices();

    let serviceToUse;

    // Check for a project-specific override
    if (projectSettings.defaultSubtitleLookupServiceId) {
      serviceToUse = allServices.find(s => s.id === projectSettings.defaultSubtitleLookupServiceId);
    }

    // If no override, find the global default
    if (!serviceToUse) {
      serviceToUse = allServices.find(s => s.isDefault);
    }

    if (serviceToUse) {
      this.executeLookup(serviceToUse, text);
    } else {
      this.toastService.warn('No default lookup service is configured');
    }
  }

  private executeLookup(service: SubtitleLookupService, text: string): void {
    if (!text) {
      return;
    }

    const currentClip = this.clipsStateService.currentClip();
    if (!currentClip?.hasSubtitle) {
      return;
    }

    const type = service.type || 'search';
    let finalUrl: string;
    let automationText: string | undefined;

    if (type === 'ai') {
      // AI Mode: URL is static, prompt text is passed separately
      finalUrl = service.urlTemplate;
      automationText = service.aiPrePrompt ? `${service.aiPrePrompt.trim()} "${text}"` : text;
    } else {
      // Search Mode: Text is embedded in URL
      finalUrl = service.urlTemplate.replace('%%SS', encodeURIComponent(text));
    }

    const browserType = service.browserType || this.globalSettingsStateService.subtitleLookupBrowserType();

    if (browserType === SubtitleLookupBrowserType.System) {
      window.electronAPI.openInSystemBrowser(finalUrl);

      if (automationText) {
        navigator.clipboard.writeText(automationText);
        this.toastService.info('Prompt copied to clipboard');
      }
    } else { // SubtitleLookupBrowserType.BuiltIn
      window.electronAPI.openSubtitlesLookupWindow({
        url: finalUrl,
        clipSubtitleId: currentClip.sourceSubtitles[0].id,
        originalSelection: text,
        automationText
      });
    }
  }

  private drawerListener = effect(() => {
    const isSettingsOpen = this.projectSettingsStateService.isSettingsDrawerOpen();
    const isNotesOpen = this.projectSettingsStateService.isNotesDrawerOpen();
    const isOpen = isSettingsOpen || isNotesOpen;

    if (isOpen) {
      this.toastService.setPosition('top-center');
      untracked(() => this.subtitlesOverlay().clearHighlightAndPopup());

      if (!this.wasSettingsDrawerOpened) {
        // Drawer is opening (was closed before)
        this.wasPlayingBeforeSettingsOpened = this.clipsStateService.isPlaying();
        if (this.wasPlayingBeforeSettingsOpened) {
          window.electronAPI.playbackPause();
        }
      }
    } else if (!isOpen && this.wasSettingsDrawerOpened) {
      // Restore default notification position
      this.toastService.setPosition('top-right');

      // Drawer is closing
      if (this.wasPlayingBeforeSettingsOpened) {
        window.electronAPI.playbackPlay();
      }
      this.wasPlayingBeforeSettingsOpened = false;
    }

    this.wasSettingsDrawerOpened = isOpen;
  });

  private editCurrentSubtitlesListener = effect(() => {
    if (this.videoStateService.editSubtitlesRequest()) {
      untracked(() => this.subtitlesOverlay().clearHighlightAndPopup());
      const currentClip = this.clipsStateService.currentClipForAllTracks();
      if (!currentClip || !currentClip.hasSubtitle) {
        this.toastService.info('Subtitle editing is not available for gaps');
        this.videoStateService.clearEditSubtitlesRequest();
        return;
      }

      if (!this.canEditSubtitles()) {
        this.toastService.info('Subtitle editing is only available in the "Interactive (ASS.js)" renderer mode');
        this.videoStateService.clearEditSubtitlesRequest();
        return;
      }

      const data: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

      const dialogRef = this.dialogService.open(EditSubtitlesDialogComponent, {
        header: 'Edit Subtitles',
        width: '50vw',
        modal: true,
        closeOnEscape: false,
        data
      });

      this.watchDialogPlaybackState(dialogRef);

      dialogRef.onClose.pipe(
        take(1)
      ).subscribe((result: ClipContent | undefined) => {
        if (!result) {
          return; // Closed without saving or no changes were made
        }

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
      this.videoStateService.clearEditSubtitlesRequest();
    }
  });

  private requestAnkiExportListener = effect(() => {
    const request = this.videoStateService.ankiExportRequest();
    if (request) {
      this.openAnkiExportDialog(request.instant);
      this.videoStateService.clearAnkiExportRequest();
    }
  });

  private dialogOpenListener = effect(() => {
    this.dialogOrchestrationService.dialogOpenedTrigger();
    untracked(() => {
      this.subtitlesOverlay().clearHighlightAndPopup();
    });
  });

  private mediaNavigationSyncEffect = effect(() => {
    const next = Boolean(this.videoStateService.nextMediaPath());
    const prev = Boolean(this.videoStateService.prevMediaPath());
    untracked(() => {
      this.headerCurrentProjectActionBridgeService.updateMediaNavigationState(next, prev);
    });
  });

  private startPlaybackSequence(): void {
    const project = this.project();
    if (!project) {
      this.videoStateService.setVideoLoading(false);
      return;
    }

    const duration = this.videoStateService.duration();
    if (duration <= 0) {
      this.videoStateService.setVideoLoading(false);
      return;
    }

    const seekTime = project.lastPlaybackTime;
    console.log(`[ProjectDetails] Startup sequence. Seeking to last known time: ${seekTime}`);

    const allClips = this.clipsStateService.clipsForAllTracks();
    const targetClipIndex = allClips.findIndex(c => seekTime >= c.startTime && seekTime < c.endTime);

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
    // Use the ID of the first source subtitle as a stable, representative identifier for the virtual clip
    const representativeSourceId = clip.sourceSubtitles[0]?.id;
    if (!representativeSourceId) {
      throw new Error('Cannot create subtitle data from a clip with no source subtitles.');
    }

    const virtualTrackNumber = -1;

    if (this.isAssProject()) {
      // Flatten all source parts, stamping each with its parent's track number
      const allPartsWithTracks = clip.sourceSubtitles.flatMap(sub =>
        sub.type === 'ass'
          ? sub.parts.map(part => ({...part, track: sub.track}))
          : []
      );

      // De-duplicate the list based on visual content (style + text).
      // This correctly groups identical animation lines into one entry.
      const uniquePartsMap = new Map<string, DialogSubtitlePart>();
      for (const part of allPartsWithTracks) {
        const key = `${part.style}::${part.text}`;
        if (!uniquePartsMap.has(key)) {
          uniquePartsMap.set(key, part);
        }
      }
      const finalParts = Array.from(uniquePartsMap.values());

      return {
        type: 'ass',
        id: representativeSourceId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        parts: finalParts,
        track: virtualTrackNumber
      };
    } else { // srt
      return {
        type: 'srt',
        id: representativeSourceId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        text: clip.text || '',
        track: virtualTrackNumber
      };
    }
  }

  private addNoteToProject(clipSubtitleId: string, selection: string, text: string): void {
    const project = this.project();
    if (!project) {
      return;
    }

    const newProjectNotes = cloneDeep(project.notes ?? {});

    // Ensure the note object for the specific clip exists
    const clipNotes = newProjectNotes[clipSubtitleId] ?? {};
    newProjectNotes[clipSubtitleId] = clipNotes;

    // Ensure the lookupNotes object exists within that clip's notes
    const lookupNotes = clipNotes.lookupNotes ?? {};
    clipNotes.lookupNotes = lookupNotes;

    // Ensure the array for the specific selection exists
    const selectionArray = lookupNotes[selection] ?? [];
    lookupNotes[selection] = selectionArray;

    // Add the new note text to the array
    selectionArray.push(text);

    this.appStateService.updatePartialProject(project.id, {notes: newProjectNotes});
  }

  private generateAudioPeaksInBackground(projectId: string, mediaPath: string): void {
    console.log('[ProjectDetails] No waveform peaks found. Generating new waveform peaks in the background...');

    const trackIndex = this.project()?.settings.selectedAudioTrackIndex ?? undefined;

    window.electronAPI.generateAudioPeaks(projectId, mediaPath, trackIndex)
      .then(audioPeaks => {
        // Check if the project still exists in state before updating (user could have deleted it while the timeline was being generated)
        const projectStillExists = this.appStateService.projects().some(p => p.id === projectId);

        if (!projectStillExists) {
          console.log('[ProjectDetails] Project no longer exists or was closed. Skipping waveform update.');
          return;
        }

        if (audioPeaks) {
          // Success: Update store. Timeline component effect will pick this up and render.
          this.appStateService.updateEntireProject(projectId, {audioPeaks});
        } else {
          console.warn('[ProjectDetails] Failed to generate timeline waveform (result was null). Fallback to empty waveform.');
          // Fallback: Update with empty peaks so timeline stops waiting and renders empty waveform
          this.appStateService.updateEntireProject(projectId, {audioPeaks: [[0]]});
        }
      })
      .catch(e => {
        console.error(`[ProjectDetails] Failed to generate timeline waveform: ${e.message}`);

        const projectStillExists = this.appStateService.projects().some(p => p.id === projectId);
        if (!projectStillExists) {
          return;
        }

        // Error fallback: Update with empty peaks so timeline stops waiting
        this.appStateService.updateEntireProject(projectId, {audioPeaks: [[0]]});
      });
  }

  private getMpvAudioTrackId(audioTracks: MediaTrack[], selectedIndex: number | null): number | null {
    if (selectedIndex === null || !audioTracks) {
      return null;
    }
    const index = audioTracks.findIndex(t => t.index === selectedIndex);
    if (index !== -1) {
      return index + 1; // MPV uses 1-based relative audio track IDs
    }
    return null;
  }

  private async initializeYomitan(language: string) {
    try {
      await this.yomitanService.setLanguage(language);

      if (language === 'other') {
        this.isYomitanEnabled.set(false);
        console.log(`[ProjectDetails] Yomitan Disabled (Language: other)`);
        return;
      }

      const infoResponse = await this.yomitanService.getDictionaryInfo();
      const installedDicts = infoResponse?.result || [];
      const optionsResponse = await this.yomitanService.getOptions();
      const profileDictionaries = optionsResponse?.result?.dictionaries || [];

      const hasValidDictionary = installedDicts.some((info: any) => {
        const config = profileDictionaries.find((d: any) => d.name === info.title);
        if (!config || !config.enabled) return false;

        let dictLang = info.sourceLanguage;
        if (!dictLang || dictLang === '') {
          dictLang = 'ja'; // Legacy JMdict fix
        }

        return dictLang === language;
      });

      this.isYomitanEnabled.set(hasValidDictionary);
      console.log(`[ProjectDetails] Yomitan Sync: Language=${language}, Dictionaries=${hasValidDictionary}`);
    } catch (e) {
      console.warn('[ProjectDetails] Failed to sync with Yomitan:', e);
      this.isYomitanEnabled.set(false);
    }
  }

  private openNoteDialog(term: string, noteText: string = '', isTermEditable: boolean = true): void {
    const restoreFocusability = disableFocusInParentDialog();

    const data: NoteFormDialogData = {
      mode: 'create',
      term,
      noteText,
      isTermEditable
    };

    const dialogRef = this.dialogService.open(NoteFormDialogComponent, {
      header: isTermEditable ? 'Add manual note' : 'Add note to highlighted text',
      width: 'clamp(20rem, 95vw, 35rem)',
      modal: true,
      closeOnEscape: false,
      data
    });

    this.watchDialogPlaybackState(dialogRef);

    dialogRef.onClose.pipe(take(1)).subscribe((result: NoteFormResult | undefined) => {
      scheduleRestoreFocus(restoreFocusability);
      if (result) {
        const currentClip = this.clipsStateService.currentClipForAllTracks();
        const subtitleId = currentClip?.sourceSubtitles[0]?.id;

        if (subtitleId) {
          this.addNoteToProject(subtitleId, result.term, result.noteText);
          this.toastService.success('Note added');
        } else {
          this.toastService.error('Could not determine context for note');
        }
      }
    });
  }

  private openFindSubtitlesDialog(): void {
    untracked(() => this.subtitlesOverlay().clearHighlightAndPopup());

    const data: SearchSubtitlesDialogData = {
      clips: this.clipsStateService.clipsForAllTracks(),
      currentTime: this.videoStateService.currentTime()
    };

    const dialogRef = this.dialogService.open(SearchSubtitlesDialogComponent, {
      header: 'Find in Subtitles',
      width: 'clamp(20rem, 95vw, 60rem)',
      contentStyle: {
        "max-height": "80vh",
        "overflow": "hidden",
        "display": "flex",
        "flex-direction": "column",
        "padding": "0"
      },
      modal: true,
      dismissableMask: true,
      closeOnEscape: true,
      data
    });

    this.watchDialogPlaybackState(dialogRef);

    dialogRef.onClose.pipe(take(1)).subscribe((result: VideoClip | undefined) => {
      if (result) {
        this.videoStateService.seekAbsolute(result.startTime);
      }
    });
  }

  private openSubtitleOffsetDialog(): void {
    const data: SubtitleOffsetDialogData = {
      validate: (offset: number) => this.clipsStateService.validateGlobalShift(offset),
      apply: (offset: number) => this.clipsStateService.shiftAllSubtitles(offset)
    };

    const dialogRef = this.dialogService.open(SubtitleOffsetDialogComponent, {
      header: 'Shift All Subtitles',
      width: 'clamp(20rem, 95vw, 40rem)',
      modal: true,
      data
    });

    this.watchDialogPlaybackState(dialogRef);
  }

  private watchDialogPlaybackState(ref: DynamicDialogRef): void {
    this.activeDialogRef?.close(); // Close any already open dialog
    this.activeDialogRef = ref;

    const wasPlaying = this.clipsStateService.isPlaying();
    if (wasPlaying) {
      window.electronAPI.playbackPause();
    }

    ref.onClose.pipe(take(1)).subscribe(() => {
      if (this.activeDialogRef === ref) {
        this.activeDialogRef = null;
      }
      if (wasPlaying) {
        window.electronAPI.playbackPlay();
      }
    });
  }
}
