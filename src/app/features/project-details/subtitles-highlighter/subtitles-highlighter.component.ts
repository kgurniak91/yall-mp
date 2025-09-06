import {Component, inject} from '@angular/core';
import {SubtitlesHighlighterService} from '../services/subtitles-highlighter/subtitles-highlighter.service';
import {AsyncPipe} from '@angular/common';

@Component({
  selector: 'app-subtitles-highlighter',
  imports: [
    AsyncPipe
  ],
  templateUrl: './subtitles-highlighter.component.html',
  styleUrl: './subtitles-highlighter.component.scss'
})
export class SubtitlesHighlighterComponent {
  protected readonly rects$ = inject(SubtitlesHighlighterService).highlightRects$;
}
