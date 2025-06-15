import {Component, effect, ElementRef, HostListener, inject, OnDestroy, signal, viewChild} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video-state.service';

const INITIAL_ZOOM = 100; // Initial pixels per second (higher is more zoomed in)
const MIN_ZOOM = 20;      // Minimum pixels per second
const MAX_ZOOM = 1000;    // Maximum pixels per second
const ZOOM_FACTOR = 1.2;  // How much to zoom in/out on each zoom

const ACTIVE_BACKGROUND = 'rgba(0, 150, 255, 0.3)';
const INACTIVE_SUBTITLE_BACKGROUND = 'rgba(255, 165, 0, 0.2)';
const GAP_BACKGROUND = 'rgba(100, 100, 100, 0.1)';

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
  private lastDrawnClipsSignature: string | null = null;
  private lastActiveRegionId: string | null = null;
  private regionDrawDebounceTimer: any;

  private timelineRenderer = effect(() => {
    const clips = this.videoStateService.clips();
    const activeClipId = this.videoStateService.lastActiveSubtitleClipId();
    const duration = this.videoStateService.duration();
    const videoElement = this.videoStateService.videoElement();
    const container = this.timelineContainer()?.nativeElement;

    const clipsSignature = clips.map(c => `${c.id}@${c.startTime}:${c.endTime}`).join(',');

    if (!this.wavesurfer && videoElement && container && duration > 0) {
      this.initializeWaveSurfer(videoElement, container);
    }

    const shadowRoot = container?.querySelector('div')?.shadowRoot;
    if (!this.wsRegions || !shadowRoot) return;

    if (clipsSignature !== this.lastDrawnClipsSignature) {
      this.drawRegions(clips);
      this.lastDrawnClipsSignature = clipsSignature;
    }

    if (this.lastActiveRegionId !== activeClipId) {
      const clipsMap = this.videoStateService.clipsMap();

      if (this.lastActiveRegionId) {
        const oldRegionElement = shadowRoot.querySelector(`[part~="${this.lastActiveRegionId}"]`) as HTMLElement;
        const oldClip = clipsMap.get(this.lastActiveRegionId);
        if (oldRegionElement && oldClip) {
          oldRegionElement.style.backgroundColor = oldClip.hasSubtitle ? INACTIVE_SUBTITLE_BACKGROUND : GAP_BACKGROUND;
        }
      }

      if (activeClipId) {
        const newRegionElement = shadowRoot.querySelector(`[part~="${activeClipId}"]`) as HTMLElement;
        if (newRegionElement) {
          newRegionElement.style.backgroundColor = ACTIVE_BACKGROUND;
        }
      }
      this.lastActiveRegionId = activeClipId;
    }
  });

  ngOnDestroy() {
    clearTimeout(this.regionDrawDebounceTimer);
    this.wavesurfer?.destroy();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
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
      console.log('Zoom finished, triggering redraw check.');
    }, 50);
  }

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

    this.wsRegions = this.wavesurfer.registerPlugin(RegionsPlugin.create());
    this.setupEventListeners();
  }

  private setupEventListeners() {
    if (!this.wsRegions) return;
    this.wsRegions.on('region-updated', (region: Region) => {
      const originalClip = this.videoStateService.clips().find(c => c.id === region.id);
      if (!originalClip) {
        console.error('Could not find corresponding clip in state for region:', region.id);
        return;
      }
      const hasChanged = originalClip.startTime !== region.start || originalClip.endTime !== region.end;
      if (!hasChanged) return;
      this.videoStateService.updateClipTimes(region.id, region.start, region.end);
    });
    this.wsRegions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      this.wavesurfer?.seekTo(region.start / this.wavesurfer.getDuration());
    });
  }

  private drawRegions(clips: any[]) {
    if (!this.wsRegions) return;
    this.wsRegions.clearRegions();
    clips.forEach(clip => {
      this.wsRegions?.addRegion({
        id: clip.id,
        start: clip.startTime,
        end: clip.endTime,
        color: clip.hasSubtitle ? INACTIVE_SUBTITLE_BACKGROUND : GAP_BACKGROUND,
        drag: false,
        resize: true,
      });
    });
  }
}
