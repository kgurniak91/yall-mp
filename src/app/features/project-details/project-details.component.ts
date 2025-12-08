import {Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked, viewChild} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {
  ProjectKeyboardShortcutsService
} from './services/project-keyboard-shortcuts/project-keyboard-shortcuts.service';
import {KeyboardAction, VideoClip} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ActivatedRoute, Router} from '@angular/router';
import {AppStateService} from '../../state/app/app-state.service';
import {ProjectSettingsStateService} from '../../state/project-settings/project-settings-state.service';
import {
  BuiltInSettingsPresets,
  ProjectSettings,
  SettingsPreset,
  SubtitleLookupBrowserType,
  SubtitleLookupService
} from '../../model/settings.types';
import {DialogService, DynamicDialogRef} from 'primeng/dynamicdialog';
import {CommandHistoryStateService} from '../../state/command-history/command-history-state.service';
import {EditSubtitlesDialogComponent} from './edit-subtitles-dialog/edit-subtitles-dialog.component';
import {ClipContent, UpdateClipTextCommand} from '../../model/commands/update-clip-text.command';
import {take} from 'rxjs';
import {ToastService} from '../../shared/services/toast/toast.service';
import type {DialogSubtitlePart, SubtitleData} from '../../../../shared/types/subtitle.type';
import {DropdownModule} from 'primeng/dropdown';
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
import {FileOpenIntentService} from '../../core/services/file-open-intent/file-open-intent.service';
import {MediaTrack} from '../../../../shared/types/media.type';

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
    OverlayBadgeModule
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
    TokenizationService
  ]
})
export class ProjectDetailsComponent implements OnInit, OnDestroy {
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
  protected readonly project = computed(() => {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (!projectId || this.appStateService.currentProjectId() !== projectId) {
      return null;
    }
    return this.appStateService.currentProject();
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
  protected readonly subtitlesMenuItems = signal<MenuItem[]>([]);
  protected readonly timelineMenuItems = signal<MenuItem[]>([]);
  protected readonly isSubtitlesContextMenuOpen = signal(false);
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
  private readonly fileOpenIntentService = inject(FileOpenIntentService);
  private dialogRef: DynamicDialogRef | undefined;
  private isMpvReady = signal(false);
  private isUiReady = signal(false);
  private hasFiredStartupSequence = false;
  private hasSetInitialClip = false;
  private cleanupInitialSeekListener: (() => void) | null = null;
  private cleanupMpvReadyListener: (() => void) | null = null;
  private cleanupAddNoteListener: (() => void) | null = null;
  private clickTimeout: any = null;

  constructor() {
    inject(ProjectKeyboardShortcutsService); // start listening
    inject(TokenizationService); // start listening
    this.headerCurrentProjectActionBridgeService.register(this.commandHistoryStateService);

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
        this.appStateService.updateProject(project.id, {duration: duration});
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
        window.electronAPI.playbackLoadProject(allClips, settings, project.lastPlaybackTime);
        this.startPlaybackSequence();
      }
    });

    effect(() => {
      if (!this.videoStateService.isPaused()) {
        this.timelineContextMenu().hide();
        this.subtitlesContextMenu().hide();
      }
    });

    this.cleanupMpvReadyListener = window.electronAPI.onMpvManagerReady(() => {
      console.log('[ProjectDetails] Received mpv:managerReady signal!');
      this.isMpvReady.set(true);
    });
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

        this.appStateService.updateProject(projectId, {
          rawAssContent: subtitleResult.rawAssContent,
          styles: subtitleResult.styles,
          subtitles: subtitleResult.subtitles,
          detectedLanguage: subtitleResult.detectedLanguage,
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

    try {
      await window.electronAPI.mpvCreateViewport(
        foundProject.mediaPath,
        audioTrackId,
        foundProject.subtitleSelection,
        foundProject.subtitleTracks,
        foundProject.settings.useMpvSubtitles,
        foundProject.settings.subtitlesVisible
      );
    } catch (e: any) {
      console.error('MPV failed to initialize unexpectedly', e);
      this.toastService.error(`The media player failed to start: ${e.message || 'The file may be corrupt or unsupported.'}`);
      this.videoStateService.setVideoLoading(false);
      this.router.navigate(['/projects']);
    }
  }

  ngOnDestroy(): void {
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

  loadAdjacentMedia(direction: 'next' | 'previous'): void {
    const targetPath = direction === 'next'
      ? this.videoStateService.nextMediaPath()
      : this.videoStateService.prevMediaPath();

    if (targetPath) {
      this.fileOpenIntentService.openMedia(targetPath);
    }
  }

  async openAnkiExportDialog(): Promise<void> {
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
      this.toastService.info('Anki export is only available for subtitled clips.');
      return;
    }

    const subtitleForExport: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

    const data: ExportToAnkiDialogData = {
      subtitleData: subtitleForExport,
      project: this.project()!,
      exportTime: this.videoStateService.currentTime()
    };

    this.dialogService.open(ExportToAnkiDialogComponent, {
      header: 'Export to Anki',
      width: 'clamp(20rem, 95vw, 45rem)',
      focusOnShow: false,
      modal: true,
      closable: true,
      closeOnEscape: false,
      data
    });
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

  onAnkiTagsChange(ankiTags: string[]) {
    const project = this.project();
    if (project) {
      this.appStateService.updateProject(project.id, {ankiTags});
    }
  }

  onVideoAreaClick(): void {
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

    allServices.forEach(service => {
      const isDefault = service.id === effectiveDefaultServiceId;
      const menuItem: MenuItem = {
        label: service.name,
        badge: isDefault ? 'Default' : undefined,
        badgeStyleClass: 'default-lookup-service-badge',
        command: () => this.executeLookup(service, this.selectedSubtitleTextForMenu)
      };

      menuItems.push(menuItem);
    });

    menuItems.push(
      {separator: true},
      {
        label: 'Copy to Clipboard',
        icon: 'fa-solid fa-copy',
        command: () => navigator.clipboard.writeText(this.selectedSubtitleTextForMenu)
      },
      {
        label: 'Configure...',
        icon: 'fa-solid fa-cog',
        command: () => this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.SubtitlesLookup)
      }
    );

    this.subtitlesMenuItems.set(menuItems);
    this.subtitlesContextMenu().show(payload.event);
  }

  onSubtitlesContextMenuHide(): void {
    this.isSubtitlesContextMenuOpen.set(false);
  }

  onHideTimelineContextMenu(): void {
    this.timelineContextMenu().hide();
  }

  onTimelineContextMenu(payload: { event: MouseEvent, clipId: string }): void {
    this.subtitlesContextMenu().hide();

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

        // Lookup Notes Info
        let lookupNotesCount = 0;
        if (clipNotes?.lookupNotes) {
          lookupNotesCount = Object.values(clipNotes.lookupNotes).reduce((acc, notes) => acc + notes.length, 0);
        }
        items.push({
          label: `${lookupNotesCount} lookup note(s)`,
          icon: 'fa-solid fa-clipboard-list',
          disabled: true,
          styleClass: 'opacity-70'
        });

        // Manual Note Info
        const hasManualNote = (clipNotes?.manualNote?.trim()?.length || 0) > 0;
        items.push({
          label: hasManualNote ? 'Manual note present' : 'No manual note',
          icon: hasManualNote ? 'fa-solid fa-check text-green-500' : 'fa-solid fa-xmark',
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
          command: () => this.openAnkiExportDialog()
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
    }

    this.timelineMenuItems.set(items);
    this.timelineContextMenu().show(payload.event);

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

  onTimelineContextMenuHide(): void {
    // Re-enable WaveSurfer's auto-scrolling for normal behavior once the menu is closed
    this.timelineEditor().setAutoScroll(true);
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
      this.toastService.warn('No default lookup service is configured.');
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

    const finalUrl = service.urlTemplate.replace('%%SS', encodeURIComponent(text));
    const browserType = service.browserType || this.globalSettingsStateService.subtitleLookupBrowserType();

    if (browserType === SubtitleLookupBrowserType.System) {
      window.electronAPI.openInSystemBrowser(finalUrl);
    } else { // SubtitleLookupBrowserType.BuiltIn
      window.electronAPI.openSubtitlesLookupWindow({
        url: finalUrl,
        clipSubtitleId: currentClip.sourceSubtitles[0].id,
        originalSelection: text
      });
    }
  }

  private settingsDrawerListener = effect(() => {
    const isOpen = this.projectSettingsStateService.isSettingsDrawerOpen();

    if (isOpen && !this.wasSettingsDrawerOpened) {
      // Drawer is opening (was closed before)
      this.wasPlayingBeforeSettingsOpened = this.clipsStateService.isPlaying();
      if (this.wasPlayingBeforeSettingsOpened) {
        window.electronAPI.playbackPause();
      }
    } else if (!isOpen && this.wasSettingsDrawerOpened) {
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
      const currentClip = this.clipsStateService.currentClipForAllTracks();
      if (!currentClip || !currentClip.hasSubtitle) {
        this.toastService.info('Subtitle editing is not available for gaps.');
        this.videoStateService.clearEditSubtitlesRequest();
        return;
      }

      if (!this.canEditSubtitles()) {
        this.toastService.info('Subtitle editing is only available in the "Interactive (ASS.js)" renderer mode.');
        this.videoStateService.clearEditSubtitlesRequest();
        return;
      }

      const data: SubtitleData = this.createSubtitleDataFromVideoClip(currentClip);

      this.dialogRef = this.dialogService.open(EditSubtitlesDialogComponent, {
        header: 'Edit Subtitles',
        width: '50vw',
        modal: true,
        closeOnEscape: false,
        data
      });

      this.dialogRef.onClose.pipe(
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

    this.appStateService.updateProject(project.id, {notes: newProjectNotes});
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
          this.appStateService.updateProject(projectId, {audioPeaks});
        } else {
          console.warn('[ProjectDetails] Failed to generate timeline waveform (result was null). Fallback to empty waveform.');
          // Fallback: Update with empty peaks so timeline stops waiting and renders empty waveform
          this.appStateService.updateProject(projectId, {audioPeaks: [[0]]});
        }
      })
      .catch(e => {
        console.error(`[ProjectDetails] Failed to generate timeline waveform: ${e.message}`);

        const projectStillExists = this.appStateService.projects().some(p => p.id === projectId);
        if (!projectStillExists) {
          return;
        }

        // Error fallback: Update with empty peaks so timeline stops waiting
        this.appStateService.updateProject(projectId, {audioPeaks: [[0]]});
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
}
