import {Component, inject, OnInit, signal} from '@angular/core';
import {VideoControllerComponent} from './video-controller/video-controller.component';
import {VideoJsOptions} from './video-controller/video-controller.type';
import {ParsedCaptionsResult, parseResponse} from 'media-captions';
import {VideoStateService} from '../../state/video/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';
import {Button} from 'primeng/button';
import {Tooltip} from 'primeng/tooltip';
import {Drawer} from 'primeng/drawer';
import {ProjectSettingsComponent} from './project-settings/project-settings.component';
import {KeyboardShortcutsService} from './services/keyboard-shortcuts/keyboard-shortcuts.service';
import {SeekDirection} from '../../model/video.types';
import {ClipPlayerService} from './services/clip-player/clip-player.service';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoControllerComponent,
    TimelineEditorComponent,
    Button,
    Tooltip,
    Drawer,
    ProjectSettingsComponent
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss',
  providers: [
    KeyboardShortcutsService
  ]
})
export class ProjectDetailsComponent implements OnInit {
  protected readonly isSettingsVisible = signal(false);
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly clipPlayerService = inject(ClipPlayerService);
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

  constructor() {
    inject(KeyboardShortcutsService); // start listening
  }

  async ngOnInit() {
    const response = fetch('/temp/marvel.srt');
    const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
    this.videoStateService.setCues(result.cues);
  }

  goToNextSubtitleClip() {
    this.clipPlayerService.goToAdjacentSubtitleClip(SeekDirection.Next);
  }

  goToPreviousSubtitleClip() {
    this.clipPlayerService.goToAdjacentSubtitleClip(SeekDirection.Previous);
  }

  togglePlayPause() {
    this.videoStateService.togglePlayPause();
  }

  repeatCurrentClip() {
    this.videoStateService.repeatCurrentClip();
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
}
