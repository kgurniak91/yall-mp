import {inject, Injectable, OnDestroy} from '@angular/core';
import {VideoStateService} from '../../../state/video-state.service';
import {KeyboardAction, SeekDirection} from '../../../model/video.types';

const SEEK_SECONDS = 2;

@Injectable()
export class KeyboardShortcutsService implements OnDestroy {
  private videoStateService = inject(VideoStateService);

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
    keyMap.set(' ', KeyboardAction.TogglePlayPause);
    keyMap.set('ArrowUp', KeyboardAction.RepeatLastClip);
    keyMap.set('ArrowDown', KeyboardAction.ForceContinue);

    let action: KeyboardAction | undefined;

    if (event.ctrlKey) {
      if (event.key === 'ArrowLeft') {
        action = KeyboardAction.PreviousSubtitleClip;
      } else if (event.key === 'ArrowRight') {
        action = KeyboardAction.NextSubtitleClip;
      }
    } else {
      if (event.key === 'ArrowLeft') {
        action = KeyboardAction.SeekBackward;
      } else if (event.key === 'ArrowRight') {
        action = KeyboardAction.SeekForward;
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
        this.videoStateService.seekRelative(-SEEK_SECONDS);
        break;
      case KeyboardAction.SeekForward:
        this.videoStateService.seekRelative(SEEK_SECONDS);
        break;
      case KeyboardAction.PreviousSubtitleClip:
        this.videoStateService.goToAdjacentSubtitleClip(SeekDirection.Previous);
        break;
      case KeyboardAction.NextSubtitleClip:
        this.videoStateService.goToAdjacentSubtitleClip(SeekDirection.Next);
        break;
      case KeyboardAction.RepeatLastClip:
        this.videoStateService.repeatLastClip();
        break;
      case KeyboardAction.ForceContinue:
        this.videoStateService.forceContinue();
        break;
      case KeyboardAction.TogglePlayPause:
        this.videoStateService.togglePlayPause();
        break;
    }
  }
}
