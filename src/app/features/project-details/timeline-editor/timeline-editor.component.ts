import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  signal, untracked,
  viewChild
} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {ProgressSpinner} from 'primeng/progressspinner';

const INITIAL_ZOOM = 100;
const MIN_ZOOM = 20;
const MAX_ZOOM = 1000;
const ZOOM_FACTOR = 1.2;

@Component({
  selector: 'app-timeline-editor',
  imports: [
    ProgressSpinner
  ],
  templateUrl: './timeline-editor.component.html',
  styleUrl: './timeline-editor.component.scss'
})
export class TimelineEditorComponent implements OnDestroy, AfterViewInit {
  protected readonly timelineContainer = viewChild.required<ElementRef<HTMLDivElement>>('timeline');
  protected readonly loading = signal(true);
  private readonly isWaveSurferReady = signal(false);
  private videoStateService = inject(VideoStateService);
  private clipsStateService = inject(ClipsStateService);
  private elementRef = inject(ElementRef);
  private wavesurfer: WaveSurfer | undefined;
  private wsRegions: RegionsPlugin | undefined;
  private currentZoom = signal<number>(INITIAL_ZOOM);
  private lastDrawnClipsSignature: string | null = null;
  private activeGlowStyle!: string;
  private inactiveSubtitleBg!: string;
  private gapBg!: string;

  ngAfterViewInit(): void {
    const computedStyles = getComputedStyle(this.elementRef.nativeElement);
    const glowColor = computedStyles.getPropertyValue('--app-primary').trim();
    this.activeGlowStyle = `inset 0 0 8px 4px ${glowColor}`;
    this.inactiveSubtitleBg = computedStyles.getPropertyValue('--app-inactive-subtitle-bg').trim();
    this.gapBg = computedStyles.getPropertyValue('--app-gap-bg').trim();
  }

  ngOnDestroy(): void {
    this.wavesurfer?.un('scroll', this.handleWaveSurferScroll);
    this.wavesurfer?.un('ready', this.handleWaveSurferReady);
    this.wsRegions?.un('region-updated', this.handleRegionUpdated);
    this.wsRegions?.un('region-clicked', this.handleRegionClicked);
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

    if (!this.clipsStateService.isPlaying()) {
      this.wavesurfer.zoom(previousZoom);
      this.wavesurfer.zoom(newZoom);
    }
  }

  private syncTimelineListener = effect(() => {
    const isReady = this.isWaveSurferReady();
    const syncRequest = this.videoStateService.syncTimelineRequest();

    if (isReady && syncRequest) {
      const timeToScroll = untracked(() => this.videoStateService.currentTime());
      this.wavesurfer?.setScrollTime(timeToScroll);
    }
  });

  private timelineRenderer = effect(() => {
    const clips = this.clipsStateService.clips();
    const duration = this.videoStateService.duration();
    const videoElement = this.videoStateService.videoElement();
    const container = this.timelineContainer()?.nativeElement;
    const clipsSignature = clips.map(c => `${c.id}@${c.startTime}:${c.endTime}`).join(',');

    if (!this.wavesurfer && videoElement && container && duration > 0) {
      this.initializeWaveSurfer(videoElement, container);
    }

    if (!this.wsRegions) return;

    if (clipsSignature !== this.lastDrawnClipsSignature) {
      this.drawRegions(clips);
      this.lastDrawnClipsSignature = clipsSignature;
    }

    this.syncHighlight();
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

    this.wsRegions = this.wavesurfer.registerPlugin(RegionsPlugin.create());
    this.setupWsRegionsEventListeners();
    this.wavesurfer.on('scroll', this.handleWaveSurferScroll);
    this.wavesurfer.on('ready', this.handleWaveSurferReady);
  }

  private setupWsRegionsEventListeners() {
    if (!this.wsRegions) return;
    this.wsRegions.on('region-updated', this.handleRegionUpdated);
    this.wsRegions.on('region-clicked', this.handleRegionClicked);
    this.wsRegions.on('region-created', this.handleRegionCreated);
  }

  private handleRegionUpdated = (region: Region) => {
    this.clipsStateService.updateClipTimes(region.id, region.start, region.end);
  };

  private handleRegionClicked = (region: Region, e: MouseEvent) => {
    e.stopPropagation();
    this.videoStateService.seekAbsolute(region.start);
  }

  private handleRegionCreated = (region: Region) => {
    // When a region's DOM element is first created, check if it should be highlighted.
    const activeClipId = this.clipsStateService.currentClip()?.id || null;
    if (region.id === activeClipId) {
      (region.element as HTMLElement).style.boxShadow = this.activeGlowStyle;
    }
  };

  private handleWaveSurferScroll = () => {
    this.syncHighlight();
  };

  private handleWaveSurferReady = () => {
    // refresh editor after init just in case
    if (this.wavesurfer) {
      const currentZoom = this.currentZoom();
      this.wavesurfer.zoom(currentZoom + 1);
      this.wavesurfer.zoom(currentZoom);
      this.isWaveSurferReady.set(true);
    }
    this.loading.set(false);
  };

  private syncHighlight(): void {
    const activeClipId = this.clipsStateService.currentClip()?.id || null;
    const container = this.timelineContainer()?.nativeElement;
    const shadowRoot = container?.querySelector('div')?.shadowRoot;
    if (!shadowRoot) return;

    const allRegionElements = shadowRoot.querySelectorAll('[part~="region"]') as NodeListOf<HTMLElement>;

    allRegionElements.forEach(regionEl => {
      const partAttr = regionEl.getAttribute('part') || '';
      const regionId = partAttr.split(' ').find(p => p !== 'region');

      if (regionId === activeClipId) {
        regionEl.style.boxShadow = this.activeGlowStyle;
      } else {
        regionEl.style.boxShadow = 'none';
      }
    });
  }

  private drawRegions(clips: VideoClip[]) {
    if (!this.wsRegions) return;

    this.wsRegions.clearRegions();

    clips.forEach(clip => {
      this.wsRegions?.addRegion({
        id: clip.id,
        start: clip.startTime,
        end: clip.endTime,
        color: clip.hasSubtitle ? this.inactiveSubtitleBg : this.gapBg,
        drag: false,
        resize: true,
      });
    });
  }
}
