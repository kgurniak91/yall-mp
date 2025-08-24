import {Component, computed, effect, inject, input} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle} from '../../../model/settings.types';
import {AssStyleService} from '../../../core/services/ass-style/ass-style.service';

@Component({
  selector: 'app-subtitles-overlay',
  imports: [],
  templateUrl: './subtitles-overlay.component.html',
  styleUrl: './subtitles-overlay.component.scss'
})
export class SubtitlesOverlayComponent {
  public readonly currentClip = input<VideoClip | undefined>();
  public readonly styles = input<any>();
  protected readonly shouldBeHidden = computed(() => {
    const style = this.globalSettingsStateService.hiddenSubtitleStyle();
    return !this.videoStateService.subtitlesVisible() && style === HiddenSubtitleStyle.Hidden;
  });
  protected readonly shouldBeBlurred = computed(() => {
    const style = this.globalSettingsStateService.hiddenSubtitleStyle();
    return !this.videoStateService.subtitlesVisible() && style === HiddenSubtitleStyle.Blurred;
  });
  private readonly videoStateService = inject(VideoStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly assStyleService = inject(AssStyleService);

  constructor() {
    effect(() => {
      const currentStyles = this.styles();
      if (currentStyles) {
        console.log('[SubtitlesOverlay] Styles input updated, re-initializing style service.');
        this.assStyleService.setStyles(currentStyles);
      }
    });
  }

  protected getPartStyle(styleName: string): { [key: string]: any } {
    return this.assStyleService.getStyleAsNgStyle(styleName);
  }

  onSubtitleClick(event: MouseEvent): void {
    event.stopPropagation();
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      // If user is selecting text, don't log the click
      return;
    }
    console.log('Subtitle area clicked!', this.currentClip()?.text);
    // TODO dictionary popup
  }

  onWordSelect(): void {
    const selection = window.getSelection();
    if (selection) {
      const selectedText = selection.toString().trim();
      if (selectedText) {
        console.log(`Selected text: "${selectedText}"`);
        // TODO dictionary popup
      }
    }
  }
}
