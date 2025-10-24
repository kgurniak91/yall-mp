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
import type {SubtitleData} from '../../../../shared/types/subtitle.type';
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
import {AssSubtitlesUtils} from '../../shared/utils/ass-subtitles/ass-subtitles.utils';
import {AssEditService} from './services/ass-edit/ass-edit.service';
import {TokenizationService} from './services/tokenization/tokenization.service';
import {ContextMenu} from 'primeng/contextmenu';
import {GlobalSettingsStateService} from '../../state/global-settings/global-settings-state.service';
import {MenuItem} from 'primeng/api';
import {DialogOrchestrationService} from '../../core/services/dialog-orchestration/dialog-orchestration.service';
import {cloneDeep} from 'lodash-es';
import {GlobalSettingsTab} from '../global-settings-dialog/global-settings-dialog.types';
import {ProjectActionService} from './services/project-action/project-action.service';

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
    ContextMenu
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

  protected readonly commandHistoryStateService = inject(CommandHistoryStateService);
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly ankiStateService = inject(AnkiStateService);
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly projectSettingsStateService = inject(ProjectSettingsStateService);
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
      styles: project.styles,
      detectedLanguage: project.detectedLanguage
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
      const clips = this.clipsStateService.clips();
      const project = this.project();

      // Once the clips array is populated for the first time, find and set the correct starting index.
      if (clips.length > 0 && project && !this.hasSetInitialClip) {
        const initialClipIndex = clips.findIndex(
          c => project.lastPlaybackTime >= c.startTime && project.lastPlaybackTime < c.endTime
        );

        if (initialClipIndex !== -1) {
          this.clipsStateService.setCurrentClipByIndex(initialClipIndex);
          this.hasSetInitialClip = true; // Ensure this only runs once
        }
      }

      // Wait until UI and MPV are ready, and clips have been generated from the video's duration.
      if (this.isUiReady() && this.isMpvReady() && clips.length > 0 && !this.hasFiredStartupSequence && project) {
        this.hasFiredStartupSequence = true;
        const settings = this.projectSettingsStateService.settings();
        window.electronAPI.playbackLoadProject(clips, settings, project.lastPlaybackTime);
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
    this.videoStateService.setIsBusy(true);

    this.cleanupInitialSeekListener = window.electronAPI.onMpvInitialSeekComplete(() => {
      console.log('[ProjectDetails] Received initial-seek-complete. Hiding spinner.');
      setTimeout(() => this.videoStateService.setIsBusy(false), 25);
    });

    this.cleanupAddNoteListener = window.electronAPI.onProjectAddNote((note) => {
      this.addNoteToProject(note.clipSubtitleId, note.selection, note.text);
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

    // Set the initial playback time immediately to prevent the timeline from defaulting to 0
    this.videoStateService.setCurrentTime(foundProject.lastPlaybackTime);

    // Logic for re-entering the project - the rawAssContent should already exist in this case:
    if (foundProject.rawAssContent) {
      this.loadAndInjectFonts(projectId);
    }

    this.videoStateService.setSubtitlesVisible(foundProject.settings.subtitlesVisible);
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
    window.electronAPI.mpvHideSubtitles();
    window.electronAPI.onMpvDestroyViewport();
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

    const currentClip = this.clipsStateService.currentClip();
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
        badgeStyleClass: 'p-badge-info',
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
      if (!this.canEditSubtitles()) {
        this.toastService.info('Subtitle editing is only available in the "Interactive (ASS.js)" renderer mode.');
        this.videoStateService.clearEditSubtitlesRequest();
        return;
      }

      const currentClip = this.clipsStateService.currentClip();
      if (!currentClip || !currentClip.hasSubtitle) {
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
    const sourceId = clip.sourceSubtitles[0]?.id; // Get the ID of the first source subtitle
    if (!sourceId) {
      throw new Error('Cannot create subtitle data from a clip with no source subtitles.');
    }

    if (this.isAssProject()) {
      return {
        type: 'ass',
        id: sourceId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        parts: clip.parts
      };
    } else { // srt
      return {
        type: 'srt',
        id: sourceId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        text: clip.text || ''
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
}
