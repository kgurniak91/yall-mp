import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  output,
  viewChild
} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {SpinnerComponent} from '../../../shared/components/spinner/spinner.component';
import {VideoSurfaceRenderer} from './video-surface-renderer';

// How long the container size has to stay put before the backing store is reallocated. Assigning canvas.width
// clears the canvas, so it must not happen on every step of a window drag.
const RESIZE_SETTLE_MS = 100;

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
  public readonly videoContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('videoContainer');
  protected readonly videoStateService = inject(VideoStateService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('videoSurface');
  private renderer: VideoSurfaceRenderer | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private unsubscribeFrames: (() => void) | undefined;
  private unsubscribeProbe: (() => void) | undefined;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private hasSize = false;
  private isReadyEmitted = false;
  private appliedWidth = 0;
  private appliedHeight = 0;

  ngAfterViewInit(): void {
    const renderer = new VideoSurfaceRenderer(this.canvasRef().nativeElement);
    this.renderer = renderer;
    this.unsubscribeFrames = window.electronAPI.onVideoFrame(frame => renderer.present(frame));
    this.unsubscribeProbe = window.electronAPI.onVideoProbeStart(
      frames => renderer.startProbe(frames, black => window.electronAPI.videoProbeReport(black)));
    this.resizeObserver = new ResizeObserver(entries => this.onResize(entries[entries.length - 1]));
    try {
      this.resizeObserver.observe(this.videoContainerRef().nativeElement, {box: 'device-pixel-content-box'});
    } catch {
      this.resizeObserver.observe(this.videoContainerRef().nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeTimer);
    this.unsubscribeFrames?.();
    this.unsubscribeProbe?.();
    this.renderer?.dispose();
  }

  private onResize(entry: ResizeObserverEntry): void {
    const pixelBox = entry.devicePixelContentBoxSize?.[0];
    const width = Math.round(pixelBox ? pixelBox.inlineSize : entry.contentRect.width * window.devicePixelRatio);
    const height = Math.round(pixelBox ? pixelBox.blockSize : entry.contentRect.height * window.devicePixelRatio);
    if (width < 2 || height < 2) {
      return;
    }
    clearTimeout(this.resizeTimer);
    if (!this.hasSize) {
      // Nothing was drawn yet, so there is nothing to protect.
      this.hasSize = true;
      this.applySize(width, height);
      return;
    }
    this.resizeTimer = setTimeout(() => this.applySize(width, height), RESIZE_SETTLE_MS);
  }

  private applySize(width: number, height: number): void {
    if (width !== this.appliedWidth || height !== this.appliedHeight) {
      this.appliedWidth = width;
      this.appliedHeight = height;
      this.renderer?.setBackingSize(width, height);
      window.electronAPI.videoSurfaceSetSize(width, height);
    }
    if (!this.isReadyEmitted) {
      this.isReadyEmitted = true;
      this.ready.emit();
    }
  }
}
