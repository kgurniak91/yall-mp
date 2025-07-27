import {AfterViewInit, Component, ElementRef, OnDestroy, viewChild} from '@angular/core';

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss'
})
export class VideoPlayerComponent implements AfterViewInit, OnDestroy {
  private readonly mpvPlaceholderRef = viewChild.required<ElementRef<HTMLVideoElement>>('mpvPlaceholder');
  private resizeObserver: ResizeObserver | undefined;

  ngAfterViewInit() {
    const placeholder = this.mpvPlaceholderRef().nativeElement;

    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const rect = entry.target.getBoundingClientRect();
        const dpr = window.devicePixelRatio;

        window.electronAPI.mpvResize({
          x: Math.round(rect.left * dpr),
          y: Math.round(rect.top * dpr),
          width: Math.round(rect.width * dpr),
          height: Math.round(rect.height * dpr),
        });
      }
    });

    this.resizeObserver.observe(placeholder);
  }

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}
