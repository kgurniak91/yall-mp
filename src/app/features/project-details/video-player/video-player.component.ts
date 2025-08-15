import {
  AfterViewInit,
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

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss'
})
export class VideoPlayerComponent implements AfterViewInit, OnDestroy {
  public readonly ready = output<void>();
  protected readonly isResizing = signal(false);
  private readonly mpvPlaceholderRef = viewChild.required<ElementRef<HTMLDivElement>>('mpvPlaceholder');
  private readonly videoStateService = inject(VideoStateService);
  private resizeObserver: ResizeObserver | undefined;
  private isReadyEmitted = false;
  private resizeDebounceTimer: any;

  constructor() {
    effect(() => {
      if (this.videoStateService.forceResizeRequest()) {
        console.log('[VideoPlayer] Parent component requested a resize. Forcing redraw.');
        this.handleResize();
        this.videoStateService.clearForceResizeRequest();
      }
    });
  }

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.mpvPlaceholderRef().nativeElement);

    window.electronAPI.onMainWindowMoved(() => {
      this.handleResize();
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeDebounceTimer);
  }

  private handleResize(): void {
    if (!this.isResizing()) {
      this.isResizing.set(true);
      window.electronAPI.mpvHideVideoDuringResize();
    }

    clearTimeout(this.resizeDebounceTimer);

    this.resizeDebounceTimer = setTimeout(() => {
      const videoContainer = this.mpvPlaceholderRef()?.nativeElement;
      if (!videoContainer) {
        return;
      }

      const rect = videoContainer.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        if (!this.isReadyEmitted) {
          this.isReadyEmitted = true;
          this.ready.emit();
        }

        window.electronAPI.mpvFinishVideoResize({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });

        this.isResizing.set(false);
      }
    }, 50);
  }
}
