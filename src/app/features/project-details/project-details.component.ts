import {Component, computed, effect, inject, OnInit, signal} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoJsOptions} from './video-controller/video-controller.type';
import {ParsedCaptionsResult, parseResponse} from 'media-captions';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {ProjectSettingsComponent} from './project-settings/project-settings.component';
import {KeyboardShortcutsService} from './keyboard-shortcuts/keyboard-shortcuts.service';
import {SeekDirection} from '../../model/video.types';
import {ClipsStateService} from '../../state/clips/clips-state.service';
import {Popover} from 'primeng/popover';
import {ProjectHeaderComponent} from './project-header/project-header.component';
import {ActivatedRoute, Router} from '@angular/router';
import {ConfirmationService} from 'primeng/api';
import {ProjectsStateService} from '../../state/projects/projects-state.service';
import {Project} from '../../model/project.types';
import {SettingsStateService} from '../../state/settings/settings-state.service';
import {HiddenSubtitleStyle} from '../../model/settings.types';

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
    ProjectHeaderComponent
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss',
  providers: [
    KeyboardShortcutsService
  ]
})
export class ProjectDetailsComponent implements OnInit {
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
    const currentTime = this.videoStateService.currentTime();

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
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly clipsStateService = inject(ClipsStateService);
  protected readonly settingsStateService = inject(SettingsStateService);
  protected readonly HiddenSubtitleStyle = HiddenSubtitleStyle;
  protected readonly project = signal<Project | null>(null);
  protected readonly options: VideoJsOptions = {
    sources: [
      {
        src: '/temp/marvel.mp4',
        type: 'video/mp4'
      }
    ],
    autoplay: false,
    loop: false,
    controls: true,
    fluid: true,
    muted: false,
    inactivityTimeout: 0,
    responsive: true,
    controlBar: {
      fullscreenToggle: false,
      pictureInPictureToggle: false,
      playToggle: false
    },
    userActions: {
      doubleClick: false
    }
  };
  private wasPlayingBeforeSettingsOpened = false;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsStateService = inject(ProjectsStateService);
  private readonly confirmationService = inject(ConfirmationService);

  constructor() {
    inject(KeyboardShortcutsService); // start listening
  }

  async ngOnInit() {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      const foundProject = this.projectsStateService.getProjectById(projectId);
      if (foundProject) {
        this.project.set(foundProject);
      } else {
        this.router.navigate(['/projects']);
      }
    }

    const response = fetch('/temp/marvel.srt');
    const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
    this.clipsStateService.setCues(result.cues);
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
}
