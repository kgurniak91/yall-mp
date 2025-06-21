import {Component, effect, ElementRef, HostListener, inject, OnDestroy, signal, viewChild} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {ClipPlayerService} from '../services/clip-player/clip-player.service';

const INITIAL_ZOOM = 100;
const MIN_ZOOM = 20;
const MAX_ZOOM = 1000;
const ZOOM_FACTOR = 1.2;

const ACTIVE_GLOW_COLOR = 'rgba(0, 150, 255, 0.6)';
const ACTIVE_GLOW_STYLE = `inset 0 0 8px 4px ${ACTIVE_GLOW_COLOR}`;
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
  private videoStateService = inject(VideoStateService);
  private clipPlayerService = inject(ClipPlayerService);
  private wavesurfer: WaveSurfer | undefined;
  private wsRegions: RegionsPlugin | undefined;
  private currentZoom = signal<number>(INITIAL_ZOOM);
  private lastDrawnClipsSignature: string | null = null;
  private lastActiveRegionId: string | null = null;

  private timelineRenderer = effect(() => {
    const clips = this.videoStateService.clips();
    const duration = this.videoStateService.duration();
    const videoElement = this.videoStateService.videoElement();
    const container = this.timelineContainer()?.nativeElement;
    const activeClipId = this.clipPlayerService.currentClip()?.id || null;
    const clipsSignature = clips.map(c => `${c.id}@${c.startTime}:${c.endTime}`).join(',');

    if (!this.wavesurfer && videoElement && container && duration > 0) {
      this.initializeWaveSurfer(videoElement, container);
    }

    if (!this.wsRegions) return;

    if (clipsSignature !== this.lastDrawnClipsSignature) {
      this.drawRegions(clips);
      this.lastDrawnClipsSignature = clipsSignature;
    }

    this.applyHighlight(activeClipId);
  });

  ngOnDestroy() {
    this.wavesurfer?.un('scroll', this.handleWaveSurferScroll);
    this.wsRegions?.un('region-created', this.handleRegionCreated);
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

    const previousZoom = this.currentZoom();
    this.currentZoom.set(newZoom);
    this.wavesurfer.zoom(newZoom);

    // hack to refresh the timeline when zooming in/out so that regions don't disappear
    if (!this.clipPlayerService.isPlaying()) {
      this.wavesurfer.zoom(previousZoom);
      this.wavesurfer.zoom(newZoom);
    }
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
    this.wavesurfer.on('scroll', this.handleWaveSurferScroll);
  }

  private setupEventListeners() {
    if (!this.wsRegions) return;

    this.wsRegions.on('region-updated', (region: Region) => {
      this.videoStateService.updateClipTimes(region.id, region.start, region.end);
    });

    this.wsRegions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      const clickedClipIndex = this.videoStateService.clips().findIndex(c => c.id === region.id);
      if (clickedClipIndex > -1) {
        this.clipPlayerService.selectClip(clickedClipIndex);
      }
    });

    this.wsRegions.on('region-created', this.handleRegionCreated);
  }

  private handleRegionCreated = (region: Region) => {
    if (region.id === this.clipPlayerService.currentClip()?.id) {
      (region.element as HTMLElement).style.boxShadow = ACTIVE_GLOW_STYLE;
    }
  };

  private handleWaveSurferScroll = () => {
    this.applyHighlight(this.clipPlayerService.currentClip()?.id || null);
  };

  private applyHighlight(activeClipId: string | null): void {
    if (this.lastActiveRegionId === activeClipId) return;

    const container = this.timelineContainer()?.nativeElement;
    const shadowRoot = container?.querySelector('div')?.shadowRoot;
    if (!shadowRoot) return;

    if (this.lastActiveRegionId) {
      const oldRegionElement = shadowRoot.querySelector(`[part~="${this.lastActiveRegionId}"]`) as HTMLElement;
      if (oldRegionElement) {
        oldRegionElement.style.boxShadow = 'none';
      }
    }

    if (activeClipId) {
      const newRegionElement = shadowRoot.querySelector(`[part~="${activeClipId}"]`) as HTMLElement;
      if (newRegionElement) {
        newRegionElement.style.boxShadow = ACTIVE_GLOW_STYLE;
      }
    }

    this.lastActiveRegionId = activeClipId;
  }

  private drawRegions(clips: VideoClip[]) {
    if (!this.wsRegions) return;

    this.wsRegions.clearRegions();

    clips.forEach(clip => {
      this.wsRegions?.addRegion({
        id: clip.id,
        start: clip.startTime,
        end: clip.endTime,
        color: clip.hasSubtitle ? INACTIVE_SUBTITLE_BACKGROUND : GAP_BACKGROUND,
        drag: clip.hasSubtitle,
        resize: true,
      });
    });
  }
}
