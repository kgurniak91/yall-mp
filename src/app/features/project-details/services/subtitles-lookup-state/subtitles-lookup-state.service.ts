import {Injectable, OnDestroy, signal} from '@angular/core';

@Injectable()
export class SubtitlesLookupStateService implements OnDestroy {
  public readonly isLookupWindowOpen = signal(false);
  private cleanupListener: (() => void) | null = null;

  constructor() {
    this.cleanupListener = window.electronAPI.onLookupWindowStateChange((isVisible) => {
      this.isLookupWindowOpen.set(isVisible);
    });
  }

  ngOnDestroy(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
    }
  }

  public closeLookup(): void {
    window.electronAPI.closeLookupWindow();
    this.isLookupWindowOpen.set(false);
  }
}
