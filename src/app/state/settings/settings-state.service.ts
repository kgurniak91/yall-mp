import {Injectable, signal} from '@angular/core';
import {HiddenSubtitleStyle, SubtitleBehavior} from '../../model/settings.types';

@Injectable({
  providedIn: 'root'
})
export class SettingsStateService {
  readonly autoPauseAtStart = signal(false);
  readonly autoPauseAtEnd = signal(false);
  readonly subtitledClipSpeed = signal(1.0);
  readonly gapSpeed = signal(3.0);
  readonly subtitleBehavior = signal<SubtitleBehavior>(SubtitleBehavior.DoNothing);
  readonly adjustValueMs = signal(50);
  readonly seekSeconds = signal(2);
  readonly hiddenSubtitleStyle = signal<HiddenSubtitleStyle>(HiddenSubtitleStyle.Blurred);
}
