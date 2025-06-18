import {Component, effect, ElementRef, HostListener, inject, OnDestroy, signal, viewChild} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video-state.service';
import {VideoClip} from '../../../model/video.types';

const INITIAL_ZOOM = 100;
const MIN_ZOOM = 20;
const MAX_ZOOM = 1000;
const ZOOM_FACTOR = 1.2;

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
  private pendingHighlightClipId: string | null = null;
  private hasPlayedOnce = false; // track if the user has played the video at least once - avoid browser autoplay security errors

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

    if (!this.wsRegions) return;

    if (clipsSignature !== this.lastDrawnClipsSignature) {
      this.drawRegions(clips);
      this.lastDrawnClipsSignature = clipsSignature;
    }

    if (this.lastActiveRegionId !== activeClipId) {
      setTimeout(() => {
        const success = this.applyHighlight(activeClipId);
        if (!success && activeClipId) {
          this.pendingHighlightClipId = activeClipId;
        } else {
          this.pendingHighlightClipId = null;
        }
      });
    }
  });

  ngOnDestroy() {
    this.wavesurfer?.un('scroll', this.handleWaveSurferScroll);
    this.wavesurfer?.un('play', this.handleFirstPlay);
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
    this.currentZoom.set(newZoom);
    this.wavesurfer.zoom(newZoom);

    // hack to refresh the timeline when zooming in/out, so that regions don't disappear
    if (this.hasPlayedOnce && !this.wavesurfer.isPlaying()) {
      this.wavesurfer.playPause();
      this.wavesurfer.playPause();
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
    this.wavesurfer.on('play', this.handleFirstPlay);
  }

  private handleFirstPlay = () => {
    this.hasPlayedOnce = true;
    this.wavesurfer?.un('play', this.handleFirstPlay);
  };

  private setupEventListeners() {
    if (!this.wsRegions) return;

    this.wsRegions.on('region-updated', (region: Region) => {
      this.videoStateService.updateClipTimes(region.id, region.start, region.end);
    });

    this.wsRegions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      this.videoStateService.seekAbsolute(region.start);
    });

    this.wsRegions.on('region-created', this.handleRegionCreated);
  }

  private handleRegionCreated = (region: Region) => {
    if (region.id === this.videoStateService.lastActiveSubtitleClipId()) {
      (region.element as HTMLElement).style.backgroundColor = ACTIVE_BACKGROUND;
    }
  };

  private handleWaveSurferScroll = () => {
    if (this.pendingHighlightClipId) {
      const success = this.applyHighlight(this.pendingHighlightClipId);
      if (success) {
        this.pendingHighlightClipId = null;
      }
    }
  };

  private applyHighlight(activeClipId: string | null): boolean {
    const container = this.timelineContainer()?.nativeElement;
    const shadowRoot = container?.querySelector('div')?.shadowRoot;
    if (!shadowRoot) {
      return false;
    }

    const clipsMap = this.videoStateService.clipsMap();

    if (this.lastActiveRegionId && this.lastActiveRegionId !== activeClipId) {
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
        this.lastActiveRegionId = activeClipId;
        return true;
      } else {
        return false;
      }
    } else {
      this.lastActiveRegionId = null;
      return true;
    }
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
