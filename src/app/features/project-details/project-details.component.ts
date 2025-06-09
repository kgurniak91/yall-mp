import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {VideoPlayerComponent} from './video-player/video-player.component';
import {VideoJsOptions} from './video-player/video-player.type';
import {ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import {VideoStateService} from '../../state/video-state.service';
import {toSignal} from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-project-details',
  imports: [
    VideoPlayerComponent
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
  protected videoStateService = inject(VideoStateService);
  currentCue = computed(() => {
    const cues = this.cues();
    const currentTime = this.videoStateService.currentTime();
    if (!cues?.length) {
      return null;
    }
    return cues.find(cue => currentTime >= cue.startTime && currentTime <= cue.endTime);
  });

  async ngOnInit() {
    const result: ParsedCaptionsResult = await parseResponse(fetch('/temp/marvel.srt'), { type: 'srt' });
    this.cues.set(result.cues);
    
  }
}
