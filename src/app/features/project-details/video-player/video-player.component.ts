import {
  AfterViewInit, ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  output,
  signal,
  viewChild
} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {SpinnerComponent} from '../../../shared/components/spinner/spinner.component';

@Component({
  selector: 'app-video-player',
  imports: [
    SpinnerComponent
  ],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VideoPlayerComponent implements AfterViewInit, OnDestroy {
  public readonly ready = output<void>();
  public readonly mpvPlaceholderRef = viewChild.required<ElementRef<HTMLDivElement>>('mpvPlaceholder');
  protected readonly videoStateService = inject(VideoStateService);
  private resizeObserver: ResizeObserver | undefined;
  private isReadyEmitted = false;
  private resizeDebounceTimer: any;
  private liveResizeFrame: number | null = null;
  /**
   * macOS: the video is a native view inside this window, so it can follow every layout
   * change immediately (no debounce, no spinner) once the first placement is done. The
   * first placement still goes through the full path, which also reveals the window.
   */
  private readonly liveResize = window.electronAPI?.platform === 'darwin';
  private isMpvReady = signal(false);
  private cleanupMpvReadyListener: (() => void) | null = null;
  private cleanupMainWindowMovedListener: (() => void) | null = null;

  constructor() {
    effect(() => {
      if (this.videoStateService.forceResizeRequest()) {
        console.log('[VideoPlayer] Parent component requested a resize. Forcing redraw.');
        this.handleResize();
        this.videoStateService.clearForceResizeRequest();
      }
    });

    this.cleanupMpvReadyListener = window.electronAPI.onMpvManagerReady(() => {
      console.log('[VideoPlayer] Received mpv:managerReady, enabling resize handler.');
      this.isMpvReady.set(true);
      this.handleResize();
    });
  }

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.mpvPlaceholderRef().nativeElement);

    this.cleanupMainWindowMovedListener = window.electronAPI.onMainWindowMovedOrResized(() => {
      this.handleResize();
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeDebounceTimer);
    if (this.liveResizeFrame !== null) {
      cancelAnimationFrame(this.liveResizeFrame);
    }
    if (this.cleanupMpvReadyListener) {
      this.cleanupMpvReadyListener();
    }
    if (this.cleanupMainWindowMovedListener) {
      this.cleanupMainWindowMovedListener();
    }
  }

  private handleResize(): void {
    if (!this.isMpvReady()) {
      console.log('[VideoPlayer] handleResize called, but MPV manager is not ready yet. Ignoring.');
      return;
    }

    if (this.liveResize && this.isReadyEmitted) {
      this.scheduleLiveResize();
      return;
    }

    if (!this.videoStateService.isVideoLoading()) {
      this.videoStateService.setVideoLoading(true);
    }

    clearTimeout(this.resizeDebounceTimer);

    this.resizeDebounceTimer = setTimeout(async () => {
      try {
        const videoContainer = this.mpvPlaceholderRef()?.nativeElement;
        if (!videoContainer) return;

        const rect = videoContainer.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {
          if (!this.isReadyEmitted) {
            this.isReadyEmitted = true;
            this.ready.emit();
          }

          await window.electronAPI.mpvFinishVideoResize({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      } finally {
        this.videoStateService.setVideoLoading(false);
        if (this.liveResize) {
          // Catch up with any layout change that happened while the first placement was in flight.
          this.scheduleLiveResize();
        }
      }
    }, 250);
  }

  /** One bounds update per animation frame while the layout keeps changing. */
  private scheduleLiveResize(): void {
    if (this.liveResizeFrame !== null) {
      return;
    }
    this.liveResizeFrame = requestAnimationFrame(() => {
      this.liveResizeFrame = null;
      const videoContainer = this.mpvPlaceholderRef()?.nativeElement;
      if (!videoContainer) return;
      const rect = videoContainer.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        window.electronAPI.mpvSetVideoBounds({x: rect.left, y: rect.top, width: rect.width, height: rect.height});
      }
    });
  }
}
