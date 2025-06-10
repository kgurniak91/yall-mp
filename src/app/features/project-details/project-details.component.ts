import {Component, inject, OnInit} from '@angular/core';
import {VideoPlayerComponent} from './video-player/video-player.component';
import {VideoJsOptions} from './video-player/video-player.type';
import {ParsedCaptionsResult, parseResponse} from 'media-captions';
import {VideoStateService} from '../../state/video-state.service';
import {TimelineEditorComponent} from './timeline-editor/timeline-editor.component';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoPlayerComponent,
    TimelineEditorComponent
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss'
})
export class ProjectDetailsComponent implements OnInit {
  protected readonly videoStateService = inject(VideoStateService);
  readonly options: VideoJsOptions = {
    sources: [
      {
        src: '/temp/marvel.mp4',
        type: 'video/mp4'
      }
    ],
    autoplay: true,
    controls: true,
    fluid: true,
    muted: false,
    inactivityTimeout: 0
  };


  async ngOnInit() {
    const response = fetch('/temp/marvel.srt');
    const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
    this.videoStateService.setCues(result.cues);
  }
}
