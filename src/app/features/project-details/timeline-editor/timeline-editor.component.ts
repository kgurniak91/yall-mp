import {Component, effect, ElementRef, HostListener, inject, OnDestroy, signal, viewChild} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video-state.service';

const INITIAL_ZOOM = 150; // Initial pixels per second (higher is more zoomed in)
const MIN_ZOOM = 20;      // Minimum pixels per second
const MAX_ZOOM = 1000;    // Maximum pixels per second
const ZOOM_FACTOR = 1.2;  // How much to zoom in/out on each wheel tick

@Component({
  selector: 'app-timeline-editor',
  imports: [],
  templateUrl: './timeline-editor.component.html',
  styleUrl: './timeline-editor.component.scss'
})
export class TimelineEditorComponent implements OnDestroy {
  timelineContainer = viewChild.required<ElementRef<HTMLDivElement>>('timeline');
  protected videoStateService = inject(VideoStateService);
  private wavesurfer: WaveSurfer | undefined;
  private wsRegions: RegionsPlugin | undefined;
  private currentZoom = signal<number>(INITIAL_ZOOM);
  private regionDrawDebounceTimer: any;

  ngOnDestroy() {
    clearTimeout(this.regionDrawDebounceTimer);
    this.wavesurfer?.destroy();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    // Prevent zoom if typing in input
    if ((event.target as HTMLElement).tagName === 'INPUT' || (event.target as HTMLElement).tagName === 'TEXTAREA') {
      return;
    }

    if (event.key === '=') {
      event.preventDefault();
      this.zoomIn();
    }

    if (event.key === '-') {
      event.preventDefault();
      this.zoomOut();
    }
  }

  public onWheel(event: WheelEvent): void {
    if (!this.wavesurfer || event.shiftKey) return;
    event.preventDefault();

    
    if (event.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }
  }

  private zoomIn(): void {
    if (!this.wavesurfer) return;
    const newZoom = Math.min(this.currentZoom() * ZOOM_FACTOR, MAX_ZOOM);
    this.updateZoom(newZoom);
  }

  private zoomOut(): void {
    if (!this.wavesurfer) return;
    const newZoom = Math.max(this.currentZoom() / ZOOM_FACTOR, MIN_ZOOM);
    this.updateZoom(newZoom);
  }

  private updateZoom(newZoom: number): void {
    if (!this.wavesurfer || newZoom === this.currentZoom()) {
      return;
    }
    this.currentZoom.set(newZoom);
    this.wavesurfer.zoom(newZoom);

    clearTimeout(this.regionDrawDebounceTimer);

    this.regionDrawDebounceTimer = setTimeout(() => {
      this.drawRegions();
    }, 50);
  }

  private clipsDrawer = effect(() => {
    if (this.videoStateService.clips().length > 0) {
      this.drawRegions();
    }
  });

  private wavesurferInitializer = effect(() => {
    const videoElement = this.videoStateService.videoElement();
    const duration = this.videoStateService.duration();
    const container = this.timelineContainer()?.nativeElement;

    if (videoElement && container && (duration > 0) && !this.wavesurfer) {
      // Initialize only if ready and not yet initialized
      console.log('Video element is ready, initializing WaveSurfer...');
      this.initializeWaveSurfer(videoElement, container);
    }
  });

  private initializeWaveSurfer(videoElement: HTMLVideoElement, container: HTMLElement) {
    this.wavesurfer = WaveSurfer.create({
      container,
      media: videoElement, 
      waveColor: '#ccc',
      progressColor: '#f55', 
      barWidth: 2,
      barGap: 1,
      minPxPerSec: this.currentZoom()
    });

    // Initialize and register the Regions plugin
    this.wsRegions = this.wavesurfer.registerPlugin(RegionsPlugin.create());
    this.setupEventListeners();
    this.drawRegions();
  }

  private setupEventListeners() {
    if (!this.wsRegions) return;

    // region-updated' fires AFTER the user has finished dragging a handle.
    this.wsRegions.on('region-updated', (region: Region) => {
      // Get the original state of the clip
      
      const originalClip = this.videoStateService.clips().find(c => c.id === region.id);

      if (!originalClip) {
        console.error('Could not find corresponding clip in state for region:', region.id);
        return;
      }

      // Check if times actually changed
      const hasChanged = originalClip.startTime !== region.start || originalClip.endTime !== region.end;

      if (!hasChanged) {
        // If the start and end times are identical, it was likely just a click
        // Do nothing to avoid unnecessary state updates
        return;
      }

      // Update state if changed
      
      this.videoStateService.updateClipTimes(region.id, region.start, region.end);
    });

    
    this.wsRegions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation(); // Prevent the main timeline click from firing
      this.wavesurfer?.seekTo(region.start / this.wavesurfer.getDuration());
    });
  }

  private drawRegions() {
    // Guard against running before wsRegions is ready.
    if (!this.wsRegions) {
      return;
    }

    const clips = this.videoStateService.clips();

    // Clear existing regions
    this.wsRegions.clearRegions();

    clips.forEach(clip => {
      this.wsRegions?.addRegion({
        id: clip.id,
        start: clip.startTime,
        end: clip.endTime,
        color: clip.hasSubtitle ? 'rgba(255, 165, 0, 0.2)' : 'rgba(100, 100, 100, 0.1)',
        drag: false,
        resize: true,
      });
    });
  }

}
