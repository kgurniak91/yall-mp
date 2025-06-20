import {Injectable, signal} from '@angular/core';
import {SubtitleBehavior} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class SettingsStateService {
  readonly autoPauseAtStart = signal(false);
  readonly autoPauseAtEnd = signal(false);
  readonly subtitledClipSpeed = signal(1.0);
  readonly gapSpeed = signal(1.0);
  readonly subtitleBehavior = signal<SubtitleBehavior>(SubtitleBehavior.DoNothing);
}
