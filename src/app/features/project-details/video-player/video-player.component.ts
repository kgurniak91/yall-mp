import {AfterViewInit, Component, ElementRef, OnDestroy, output, viewChild} from '@angular/core';

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss'
})
export class VideoPlayerComponent implements AfterViewInit, OnDestroy {
  public readonly ready = output<void>();
  private readonly mpvPlaceholderRef = viewChild.required<ElementRef<HTMLDivElement>>('mpvPlaceholder');
  private resizeObserver: ResizeObserver | undefined;
  private isReadyEmitted = false;

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.sendResizeCommand());
    this.resizeObserver.observe(this.mpvPlaceholderRef().nativeElement);

    window.electronAPI.onMainWindowMoved(() => {
      this.sendResizeCommand();
    });

    setTimeout(() => this.sendResizeCommand(), 200);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private sendResizeCommand(): void {
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

      window.electronAPI.mpvResizeViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }
}
