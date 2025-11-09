import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {ClipsStateService} from '../../../state/clips/clips-state.service';
import {SpinnerComponent} from '../../../shared/components/spinner/spinner.component';

const INITIAL_ZOOM = 100;
const MIN_ZOOM = 20;
const MAX_ZOOM = 1000;
const ZOOM_FACTOR = 1.2;

@Component({
  selector: 'app-timeline-editor',
  imports: [
    SpinnerComponent
  ],
  templateUrl: './timeline-editor.component.html',
  styleUrl: './timeline-editor.component.scss'
})
export class TimelineEditorComponent implements OnDestroy, AfterViewInit {
  public readonly contextMenuRequested = output<{ event: MouseEvent, clipId: string }>();
  public readonly hideContextMenuRequested = output<void>();
  protected readonly timelineContainer = viewChild.required<ElementRef<HTMLDivElement>>('timeline');
  protected readonly loading = signal(true);
  private readonly isWaveSurferReady = signal(false);
  private videoStateService = inject(VideoStateService);
  private clipsStateService = inject(ClipsStateService);
  private elementRef = inject(ElementRef);
  private wavesurfer: WaveSurfer | undefined;
  private wsRegions: RegionsPlugin | undefined;
  private currentZoom = signal<number>(INITIAL_ZOOM);
  private hasPerformedInitialSync = signal(false);
  private lastDrawnClipsSignature: string | null = null;
  private activeGlowStyle!: string;
  private inactiveSubtitleBg!: string;
  private gapBg!: string;
  private mustIgnoreNextScroll = false;

  constructor() {
    effect(() => {
      if (this.videoStateService.zoomInRequest()) {
        this.zoomIn();
        this.videoStateService.clearZoomInRequest();
      }
    });

    effect(() => {
      if (this.videoStateService.zoomOutRequest()) {
        this.zoomOut();
        this.videoStateService.clearZoomOutRequest();
      }
    });
  }

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
    this.wsRegions?.un('region-clicked', this.handleRegionLeftClicked);
    this.wsRegions?.un('region-created', this.handleRegionCreated);
    this.wavesurfer?.destroy();
  }

  public setAutoScroll(enabled: boolean): void {
    this.wavesurfer?.setOptions({autoScroll: enabled});
  }

  public onWheel(event: WheelEvent): void {
    if (!this.wavesurfer || event.shiftKey) return;
    event.preventDefault();
    this.hideContextMenuRequested.emit();
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

    // After zooming out, perform a tiny scroll nudge to force WaveSurfer to re-render all regions
    const currentTime = this.videoStateService.currentTime();
    this.wavesurfer.setScrollTime(currentTime + 0.1);
    this.wavesurfer.setScrollTime(currentTime);
  }

  private updateZoom(newZoom: number): void {
    if (!this.wavesurfer || newZoom === this.currentZoom()) {
      return;
    }
    this.currentZoom.set(newZoom);
    this.wavesurfer.zoom(newZoom);
  }

  private timelineRenderer = effect(() => {
    const clips = this.clipsStateService.clips();
    const mediaPath = this.videoStateService.mediaPath();
    const container = this.timelineContainer()?.nativeElement;
    this.clipsStateService.activeTrackClipIndex(); // Refresh effect when current clip changes

    if (!this.wavesurfer && mediaPath && container) {
      this.initializeWaveSurfer(mediaPath, container);
    }

    if (!this.isWaveSurferReady() || !this.wsRegions || clips.length === 0) {
      return;
    }

    const clipsSignature = clips.map(c => `${c.id}@${c.startTime}:${c.endTime}`).join(',');

    if (clipsSignature !== this.lastDrawnClipsSignature) {
      this.drawRegions(clips);
      this.lastDrawnClipsSignature = clipsSignature;
    }

    // Once the first set of regions is drawn, hide the loader
    if (this.loading()) {
      setTimeout(() => {
        this.loading.set(false);

        // Scroll the timeline to the initial playback position automatically:
        if (!this.hasPerformedInitialSync()) {
          const initialTime = untracked(() => this.videoStateService.currentTime());
          this.wavesurfer?.setScrollTime(initialTime);
          this.hasPerformedInitialSync.set(true);
        }
      }, 0);
    }

    this.syncHighlight();
  });

  private playbackTimeObserver = effect(() => {
    if (!this.wavesurfer || !this.isWaveSurferReady()) return;

    const currentTime = this.videoStateService.currentTime();
    const duration = this.videoStateService.duration();

    if (duration > 0 && currentTime != null && isFinite(currentTime)) {
      const progress = currentTime / duration;

      if (isFinite(progress)) {
        this.wavesurfer.seekTo(progress);
      }
    }
  });

  private initializeWaveSurfer(mediaPath: string, container: HTMLElement) {
    this.wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#ccc',
      progressColor: '#f55',
      barWidth: 2,
      barGap: 1,
      minPxPerSec: this.currentZoom(),
      autoScroll: true,
      autoCenter: true,
      // Prevent wavesurfer from interacting with media, because the player is driven externally
      media: undefined,
      // Pass the URL directly to load the waveform
      url: `file://${mediaPath}`
    });

    this.wsRegions = this.wavesurfer.registerPlugin(RegionsPlugin.create());
    this.setupWsRegionsEventListeners();
    this.wavesurfer.on('scroll', this.handleWaveSurferScroll);
    this.wavesurfer.on('ready', this.handleWaveSurferReady);
  }

  private setupWsRegionsEventListeners() {
    if (!this.wsRegions) return;
    this.wsRegions.on('region-updated', this.handleRegionUpdated);
    this.wsRegions.on('region-clicked', this.handleRegionLeftClicked);
    this.wsRegions.on('region-created', this.handleRegionCreated);
  }

  private handleRegionUpdated = (region: Region) => {
    // Attempt to update the state based on the user's drag action.
    this.clipsStateService.updateClipTimesFromTimeline(region.id, region.start, region.end);

    // After the attempt, get the TRUE state of the clip.
    const authoritativeClip = this.clipsStateService.clips().find(c => c.id === region.id);

    // If the UI's region doesn't match the true state (because the update was invalid),
    // force the UI to snap back to the correct position.
    if (authoritativeClip && (region.start !== authoritativeClip.startTime || region.end !== authoritativeClip.endTime)) {
      // Temporarily disable the event listener to prevent an infinite loop while programmatically updating the region.
      this.wsRegions?.un('region-updated', this.handleRegionUpdated);

      region.setOptions({
        start: authoritativeClip.startTime,
        end: authoritativeClip.endTime
      });

      // Re-enable the listener for future user interactions.
      this.wsRegions?.on('region-updated', this.handleRegionUpdated);
    }
  };

  private handleRegionLeftClicked = (region: Region, e: MouseEvent) => {
    if (e.button !== 0) {
      return;
    }

    e.stopPropagation();
    this.performSeekFromMouseEvent(region, e);
    this.hideContextMenuRequested.emit();
  }

  private handleRegionCreated = (region: Region) => {
    const regionEl = region.element as HTMLElement;

    // Apply active clip glow if needed
    const activeClipId = this.clipsStateService.currentClip()?.id || null;
    if (region.id === activeClipId) {
      regionEl.style.boxShadow = this.activeGlowStyle;
    }

    // Attach right-click listener
    regionEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!this.videoStateService.isPaused()) {
        this.videoStateService.togglePlayPause();
      }

      this.performSeekFromMouseEvent(region, e);

      // Notify the parent to show the menu
      this.contextMenuRequested.emit({event: e, clipId: region.id});
    });
  };

  private performSeekFromMouseEvent(region: Region, e: MouseEvent): void {
    e.stopPropagation();
    const wrapper = this.wavesurfer?.getWrapper();
    if (wrapper) {
      const bbox = wrapper.getBoundingClientRect();
      const progress = (e.clientX - bbox.left) / bbox.width;
      const time = progress * (this.wavesurfer?.getDuration() || 0);
      this.videoStateService.seekAbsolute(time);
    } else {
      this.videoStateService.seekAbsolute(region.start);
    }
  }

  private handleWaveSurferScroll = () => {
    if (this.mustIgnoreNextScroll) {
      this.mustIgnoreNextScroll = false;
      return;
    }
    this.hideContextMenuRequested.emit();
    this.syncHighlight();
  };

  private handleWaveSurferReady = () => {
    if (this.wavesurfer) {
      this.isWaveSurferReady.set(true);
    }
  };

  private syncHighlight(): void {
    const activeClip = this.clipsStateService.currentClip();
    const activeClipId = activeClip?.id || null;
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
