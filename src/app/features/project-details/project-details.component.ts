import {Component, OnInit, signal} from '@angular/core';
import {VideoPlayerComponent} from './video-player/video-player.component';
import {VideoJsOptions} from './video-player/video-player.type';
import {parseResponse, ParsedCaptionsResult, VTTCue} from 'media-captions';
import {JsonPipe} from '@angular/common';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoPlayerComponent,
    JsonPipe
  ],
  templateUrl: './project-details.component.html',
  styleUrl: './project-details.component.scss'
})
export class ProjectDetailsComponent implements OnInit {
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
  cues = signal<VTTCue[]>([]);

  async ngOnInit() {
    const result: ParsedCaptionsResult = await parseResponse(fetch('/temp/marvel.srt'), { type: 'srt' });
    this.cues.set(result.cues);
    
  }
}
