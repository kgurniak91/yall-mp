import {inject, Injectable, OnDestroy} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {KeyboardAction, SeekDirection} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {SettingsStateService} from '../../../state/settings/settings-state.service';

@Injectable()
export class KeyboardShortcutsService implements OnDestroy {
  private videoStateService = inject(VideoStateService);
  private clipsStateService = inject(ClipsStateService);
  private settingsStateService = inject(SettingsStateService);

  constructor() {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    const keyMap = new Map<string, KeyboardAction>();
    keyMap.set('c', KeyboardAction.ToggleSubtitles);
    keyMap.set('C', KeyboardAction.ToggleSubtitles);
    keyMap.set(',', KeyboardAction.ToggleSettings);
    keyMap.set(' ', KeyboardAction.TogglePlayPause);

    let action: KeyboardAction | undefined;

    if (event.ctrlKey) {
      if (event.key === 'ArrowLeft') {
        action = KeyboardAction.PreviousSubtitledClip;
      } else if (event.key === 'ArrowRight') {
        action = KeyboardAction.NextSubtitledClip;
      } else if (event.key === 'ArrowUp') {
        action = KeyboardAction.RepeatCurrentClip;
      } else if (event.key === 'ArrowDown') {
        action = KeyboardAction.ForceContinue;
      } else if (event.key === '[') {
        action = KeyboardAction.AdjustClipStartRight;
      } else if (event.key === ']') {
        action = KeyboardAction.AdjustClipEndLeft;
      }
    } else {
      if (event.key === 'ArrowLeft') {
        action = KeyboardAction.SeekBackward;
      } else if (event.key === 'ArrowRight') {
        action = KeyboardAction.SeekForward;
      } else if (event.key === 'ArrowUp') {
        action = KeyboardAction.RepeatCurrentClip;
      } else if (event.key === 'ArrowDown') {
        action = KeyboardAction.ForceContinue;
      } else if (event.key === '[') {
        action = KeyboardAction.AdjustClipStartLeft;
      } else if (event.key === ']') {
        action = KeyboardAction.AdjustClipEndRight;
      } else {
        action = keyMap.get(event.key);
      }
    }

    if (action) {
      event.preventDefault();
      this.executeAction(action);
    }
  };

  private executeAction(action: KeyboardAction): void {
    switch (action) {
      case KeyboardAction.ToggleSubtitles:
        this.videoStateService.toggleSubtitlesVisible();
        break;
      case KeyboardAction.SeekBackward:
        this.videoStateService.seekRelative(-this.settingsStateService.seekSeconds());
        break;
      case KeyboardAction.SeekForward:
        this.videoStateService.seekRelative(this.settingsStateService.seekSeconds());
        break;
      case KeyboardAction.PreviousSubtitledClip:
        this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Previous);
        break;
      case KeyboardAction.NextSubtitledClip:
        this.clipsStateService.goToAdjacentSubtitledClip(SeekDirection.Next);
        break;
      case KeyboardAction.RepeatCurrentClip:
        this.videoStateService.repeatCurrentClip();
        break;
      case KeyboardAction.ForceContinue:
        this.videoStateService.forceContinue();
        break;
      case KeyboardAction.TogglePlayPause:
        this.videoStateService.togglePlayPause();
        break;
      case KeyboardAction.AdjustClipStartLeft:
        this.clipsStateService.adjustCurrentClipBoundary('start', 'left');
        break;
      case KeyboardAction.AdjustClipStartRight:
        this.clipsStateService.adjustCurrentClipBoundary('start', 'right');
        break;
      case KeyboardAction.AdjustClipEndLeft:
        this.clipsStateService.adjustCurrentClipBoundary('end', 'left');
        break;
      case KeyboardAction.AdjustClipEndRight:
        this.clipsStateService.adjustCurrentClipBoundary('end', 'right');
        break;
      case KeyboardAction.ToggleSettings:
        this.videoStateService.toggleSettings();
        break;
    }
  }
}
