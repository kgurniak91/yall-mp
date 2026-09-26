import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
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
import {AppStateService} from '../../../state/app/app-state.service';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';

const INITIAL_ZOOM = 80;
const MIN_ZOOM = 20;
const MAX_ZOOM = 1000;
const ZOOM_FACTOR = 1.2;

// Wheel/trackpad gesture handling (see onWheel).
/** Wheel events closer together than this belong to the same gesture. */
const WHEEL_GESTURE_GAP_MS = 150;
/** Movement (px) a gesture needs before it is classified as sideways or vertical. */
const WHEEL_AXIS_LOCK_PX = 3;
/** A single event moving at least this much is a mouse-wheel notch: one full zoom step. */
const WHEEL_NOTCH_PX = 40;
/** Vertical travel per zoom step for continuous devices (trackpad swipe or pinch). */
const WHEEL_PIXELS_PER_ZOOM_STEP = 100;
/** Zoom steps one trackpad swipe (including its momentum) may apply at most. */
const WHEEL_MAX_SWIPE_STEPS = 8;

interface WheelGesture {
  axis: 'scroll' | 'zoom' | null;
  lastAt: number;
  dx: number;
  dy: number;
  notchSteps: number;
  swipeSteps: number;
  zoomAtStart: number;
}

/** Part of the timeline strip left below the waveform for the horizontal scrollbar. */
const WAVEFORM_SCROLLBAR_SPACE_PX = 15;
const MIN_TIMELINE_HEIGHT_PX = 60;
const MAX_TIMELINE_HEIGHT_PX = 400;

/** Share of bars that must fit below full height; the rest are clipped at the top. */
const WAVEFORM_DISPLAY_PERCENTILE = 0.99;

/**
 * Stretches the waveform so that it fills the timeline's height. Quiet sources
 * (a surround downmix, a low-level recording) otherwise show as a thin line.
 * Scaling to a high percentile rather than the single loudest bar keeps speech
 * readable when the file contains a few very loud moments.
 */
export function scalePeaksToDisplay(peaks: number[]): number[] {
  if (peaks.length === 0) {
    return [];
  }
  const magnitudes = peaks.map(Math.abs).sort((a, b) => a - b);
  const index = Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * WAVEFORM_DISPLAY_PERCENTILE));
  const reference = magnitudes[index];
  if (!(reference > 0)) {
    return [...peaks];
  }
  return peaks.map(p => Math.max(-1, Math.min(1, p / reference)));
}

@Component({
  selector: 'app-timeline-editor',
  imports: [
    SpinnerComponent
  ],
  templateUrl: './timeline-editor.component.html',
  styleUrl: './timeline-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(mouseenter)': 'onPointerEnter()',
    '[style.height.px]': 'timelineHeight()'
  }
})
export class TimelineEditorComponent implements OnInit, OnDestroy, AfterViewInit {
  public readonly contextMenuRequested = output<{ event: MouseEvent, clipId: string }>();
  public readonly hideContextMenuRequested = output<void>();
  /**
   * macOS overlay scrollbars stay hidden until something scrolls, so the timeline looked
   * unscrollable. On that platform the scrollbar is flashed when the pointer enters the
   * timeline (see onPointerEnter); Windows and Linux show it permanently anyway.
   */
  private readonly revealsScrollbarOnHover = window.electronAPI?.platform === 'darwin';
  /** Height of the whole timeline strip in CSS pixels (user-adjustable, persisted). */
  protected readonly timelineHeight = computed(() => this.globalSettingsStateService.timelineHeight());
  private readonly waveformHeight = computed(() => Math.max(20, this.timelineHeight() - WAVEFORM_SCROLLBAR_SPACE_PX));
  protected readonly isCtrlPressed = signal(false);
  protected readonly timelineContainer = viewChild.required<ElementRef<HTMLDivElement>>('timeline');
  protected readonly videoStateService = inject(VideoStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly isWaveSurferReady = signal(false);
  private readonly clipsStateService = inject(ClipsStateService);
  private readonly appStateService = inject(AppStateService);
  private readonly elementRef = inject(ElementRef);
  private wavesurfer: WaveSurfer | undefined;
  private wsRegions: RegionsPlugin | undefined;
  /** The peaks array the current WaveSurfer instance was built from. */
  private renderedPeaks: number[][] | undefined;
  private readonly currentZoom = signal<number>(INITIAL_ZOOM);
  private readonly hasPerformedInitialSync = signal(false);
  private lastDrawnClipsSignature: string | null = null;
  private lastTrackIndex: number | null = null;
  private activeGlowStyle!: string;
  private inactiveSubtitleBg!: string;
  private gapBg!: string;
  private mustIgnoreNextScroll = false;
  /** Scroll events to swallow because they come from the scrollbar flash, not the user. */
  private scrollEventsToIgnore = 0;
  private resizeDrag: {pointerId: number, startY: number, startHeight: number} | null = null;
  private wheelGesture: WheelGesture | null = null;
  private wheelRedrawTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly keyHandler = (e: KeyboardEvent) => this.handleKey(e);

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

    effect(() => {
      const isCtrl = this.isCtrlPressed();
      this.updateRegionCursors(isCtrl);
    });

    effect(() => {
      const height = this.waveformHeight();
      if (this.wavesurfer && this.wavesurfer.options.height !== height) {
        this.wavesurfer.setOptions({height});
      }
    });
  }

  ngOnInit(): void {
    this.videoStateService.setTimelineLoading(true);
  }

  ngAfterViewInit(): void {
    const computedStyles = getComputedStyle(this.elementRef.nativeElement);
    const glowColor = computedStyles.getPropertyValue('--app-primary').trim();
    this.activeGlowStyle = `inset 0 0 8px 4px ${glowColor}`;
    this.inactiveSubtitleBg = computedStyles.getPropertyValue('--app-inactive-subtitle-bg').trim();
    this.gapBg = computedStyles.getPropertyValue('--app-gap-bg').trim();
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('keyup', this.keyHandler);
  }

  ngOnDestroy(): void {
    this.disposeWaveSurfer();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('keyup', this.keyHandler);
    if (this.wheelRedrawTimer !== undefined) {
      clearTimeout(this.wheelRedrawTimer);
    }
  }

  /** Tears down the WaveSurfer instance so that the renderer effect can build a fresh one. */
  private disposeWaveSurfer(): void {
    this.wavesurfer?.un('scroll', this.handleWaveSurferScroll);
    this.wavesurfer?.un('ready', this.handleWaveSurferReady);
    this.wsRegions?.un('region-updated', this.handleRegionUpdated);
    this.wsRegions?.un('region-clicked', this.handleRegionLeftClicked);
    this.wsRegions?.un('region-created', this.handleRegionCreated);
    this.wavesurfer?.destroy();
    this.wavesurfer = undefined;
    this.wsRegions = undefined;
    this.renderedPeaks = undefined;
    this.isWaveSurferReady.set(false);
    this.lastDrawnClipsSignature = null;
    this.lastTrackIndex = null;
    this.hasPerformedInitialSync.set(false);
  }

  /**
   * Shows the (macOS overlay) scrollbar when the pointer enters the timeline by scrolling
   * one pixel right and back on consecutive frames: a scroll offset change is what makes
   * the system fade the scrollbar in, and a pixel out and back leaves the view unchanged.
   */
  protected onPointerEnter(): void {
    if (!this.revealsScrollbarOnHover || !this.wavesurfer) {
      return;
    }
    const scroller = this.wavesurfer.getWrapper().parentElement;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) {
      return;
    }
    const canNudgeRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth;
    const step = canNudgeRight ? 1 : -1;
    this.scrollEventsToIgnore += 2;
    scroller.scrollLeft += step;
    requestAnimationFrame(() => {
      scroller.scrollLeft -= step;
    });
  }

  protected onResizeHandlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resizeDrag = {pointerId: event.pointerId, startY: event.clientY, startHeight: this.timelineHeight()};
  }

  protected onResizeHandlePointerMove(event: PointerEvent): void {
    if (!this.resizeDrag || event.pointerId !== this.resizeDrag.pointerId) {
      return;
    }
    // The handle is on the top edge: dragging up makes the timeline taller.
    const height = this.resizeDrag.startHeight + (this.resizeDrag.startY - event.clientY);
    this.globalSettingsStateService.setTimelineHeight(
      Math.max(MIN_TIMELINE_HEIGHT_PX, Math.min(MAX_TIMELINE_HEIGHT_PX, height))
    );
  }

  protected onResizeHandlePointerUp(event: PointerEvent): void {
    if (this.resizeDrag && event.pointerId === this.resizeDrag.pointerId) {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      this.resizeDrag = null;
    }
  }

  public setAutoScroll(enabled: boolean): void {
    this.wavesurfer?.setOptions({autoScroll: enabled});
  }

  /**
   * Mouse wheel and trackpad handling for the timeline.
   *
   * Sideways movement scrolls the timeline (left to the browser); vertical movement
   * zooms it; Shift forces scrolling and Ctrl (a trackpad pinch arrives as Ctrl+wheel)
   * forces zooming. A trackpad delivers dozens of small events per gesture, often with
   * both a sideways and a vertical part, so the decision is made once per gesture from
   * its first few pixels and kept until the gesture ends; deciding per event made a
   * sideways swipe zoom out on its diagonal events and stutter.
   *
   * Zoom amount: a mouse-wheel notch (one large event) is one zoom step, as before.
   * A trackpad swipe zooms continuously with its travel, capped per gesture so that a
   * flick with momentum cannot jump straight to the minimum or maximum zoom.
   */
  public onWheel(event: WheelEvent): void {
    if (!this.wavesurfer) return;

    const now = performance.now();
    let gesture = this.wheelGesture;
    if (!gesture || now - gesture.lastAt > WHEEL_GESTURE_GAP_MS) {
      gesture = {axis: null, lastAt: now, dx: 0, dy: 0, notchSteps: 0, swipeSteps: 0, zoomAtStart: this.currentZoom()};
      this.wheelGesture = gesture;
    }
    gesture.lastAt = now;
    gesture.dx += event.deltaX;
    gesture.dy += event.deltaY;

    if (gesture.axis === null) {
      if (event.ctrlKey) {
        gesture.axis = 'zoom';
      } else if (event.shiftKey) {
        gesture.axis = 'scroll';
      } else if (Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) < WHEEL_AXIS_LOCK_PX) {
        return; // Too little movement to tell yet.
      } else {
        gesture.axis = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'scroll' : 'zoom';
      }
    }

    if (gesture.axis === 'scroll') {
      return; // The browser scrolls wavesurfer's container natively.
    }

    event.preventDefault();
    if (event.deltaY === 0) return;
    this.hideContextMenuRequested.emit();

    const continuous = event.ctrlKey || Math.abs(event.deltaY) < WHEEL_NOTCH_PX;
    if (continuous) {
      const steps = gesture.swipeSteps - event.deltaY / WHEEL_PIXELS_PER_ZOOM_STEP;
      gesture.swipeSteps = Math.max(-WHEEL_MAX_SWIPE_STEPS, Math.min(WHEEL_MAX_SWIPE_STEPS, steps));
    } else {
      gesture.notchSteps -= Math.sign(event.deltaY);
    }

    const totalSteps = gesture.notchSteps + gesture.swipeSteps;
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.zoomAtStart * Math.pow(ZOOM_FACTOR, totalSteps)));
    this.updateZoom(target);

    // Zooming out needs the regions re-rendered (see zoomOut); do it once the gesture ends.
    if (this.wheelRedrawTimer !== undefined) {
      clearTimeout(this.wheelRedrawTimer);
    }
    this.wheelRedrawTimer = setTimeout(() => {
      this.wheelRedrawTimer = undefined;
      if (this.currentZoom() < gesture.zoomAtStart) {
        this.forceWavesurferRedraw();
      }
    }, WHEEL_GESTURE_GAP_MS);
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
    this.forceWavesurferRedraw();
  }

  private forceWavesurferRedraw() {
    if (!this.wavesurfer) {
      return;
    }

    // Capture the current visual scroll position
    const savedScroll = this.wavesurfer.getScroll();

    // Perform a tiny scroll nudge to force Wavesurfer to re-render all regions
    const currentTime = this.videoStateService.currentTime();
    this.wavesurfer.setScrollTime(currentTime + 0.1);
    this.wavesurfer.setScrollTime(currentTime);

    // Restore the original scroll position
    this.wavesurfer.setScroll(savedScroll);

    setTimeout(() => {
      this.syncHighlight();
    }, 50);
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
    const project = this.appStateService.currentProject();
    const audioPeaks = project?.audioPeaks;
    const duration = this.videoStateService.duration();
    const container = this.timelineContainer()?.nativeElement;
    const expectPeaks = this.globalSettingsStateService.generateAudioPeaks();
    const currentTrackIndex = this.clipsStateService.activeTrack();
    this.clipsStateService.activeTrackClipIndex();

    // Audio peaks are generating in the background but are not available yet
    if (expectPeaks && !audioPeaks) {
      return;
    }

    // The waveform was regenerated while the timeline was open: rebuild with the new bars.
    if (this.wavesurfer && audioPeaks && audioPeaks !== this.renderedPeaks) {
      this.disposeWaveSurfer();
    }

    if (!this.wavesurfer && duration > 0 && container) {
      this.renderedPeaks = audioPeaks;
      const processedAudioPeaks = this.processAudioPeaks(audioPeaks, duration);
      this.initializeWaveSurfer(processedAudioPeaks, duration, container);
    }

    if (!this.isWaveSurferReady() || !this.wsRegions || clips.length === 0) {
      return;
    }

    const clipsSignature = clips.map(c => `${c.id}@${c.startTime}:${c.endTime}`).join(',');

    // Defer the rest of the logic to ensure WaveSurfer has processed its initial options.
    setTimeout(() => {
      // Add a safety check in case the component is destroyed before the timeout fires.
      if (!this.wsRegions || !this.wavesurfer) {
        return;
      }

      if (clipsSignature !== this.lastDrawnClipsSignature) {
        this.drawRegions(clips);
        this.lastDrawnClipsSignature = clipsSignature;

        // Only force redraw if the track has changed (or it's the first load)
        if (this.lastTrackIndex !== currentTrackIndex) {
          this.forceWavesurferRedraw();
          this.lastTrackIndex = currentTrackIndex;
        }
      }

      // Once the first set of regions is drawn, hide the loader
      if (this.videoStateService.isTimelineLoading()) {
        this.videoStateService.setTimelineLoading(false);

        // Scroll the timeline to the initial playback position automatically:
        if (!this.hasPerformedInitialSync()) {
          const initialTime = untracked(() => this.videoStateService.currentTime());
          // Check if duration is valid before trying to scroll
          if (this.wavesurfer.getDuration() > 0) {
            this.wavesurfer.setTime(initialTime);
            this.wavesurfer.setScrollTime(initialTime);
            this.hasPerformedInitialSync.set(true);
          }
        }
      }

      this.syncHighlight();
    }, 0);
  });

  private playbackTimeObserver = effect(() => {
    if (!this.isWaveSurferReady() || !this.wavesurfer) {
      return;
    }

    const currentTime = this.videoStateService.currentTime();
    this.wavesurfer.setTime(currentTime);
  });

  private initializeWaveSurfer(processedAudioPeaks: number[][], duration: number, container: HTMLElement) {
    this.wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#ccc',
      progressColor: '#f55',
      barWidth: 3,
      barGap: 1,
      minPxPerSec: this.currentZoom(),
      autoScroll: true,
      autoCenter: true,
      // Prevent wavesurfer from interacting with media, because the player is driven externally
      media: undefined,
      peaks: processedAudioPeaks,
      duration: duration,
      height: this.waveformHeight()
    });

    this.wsRegions = this.wavesurfer.registerPlugin(RegionsPlugin.create());
    this.setupWsRegionsEventListeners();
    this.wavesurfer.on('scroll', this.handleWaveSurferScroll);

    // Manually trigger ready state since 'ready' event doesn't fire with pre-decoded peaks
    this.handleWaveSurferReady();
  }

  /**
   * Fixes progressive audio-waveform drift in VBR/CBR MP3s caused by duration
   * discrepancies between the FFmpeg decoder and MPV demuxer by padding or trimming
   * the peaks array to perfectly match the player's timeline duration.
   */
  private processAudioPeaks(audioPeaks: number[][] | undefined, duration: number): number[][] {
    if (!audioPeaks || audioPeaks.length === 0 || !audioPeaks[0] || duration <= 0) {
      return [[0]];
    }

    const PIXELS_PER_SECOND = 20; // Must be strictly consistent with the value set for the audiowaveform via `--pixels-per-second` in electron-main.ts
    const POINTS_PER_SECOND = (PIXELS_PER_SECOND * 2); // audiowaveform outputs min/max pairs for each pixel, so 20 pixels/sec * 2 = 40 data points/sec

    // Calculate expected length and ensure it's an even number (complete min/max pairs)
    let expectedLength = Math.round(duration * POINTS_PER_SECOND);
    if (expectedLength % 2 !== 0) {
      expectedLength += 1;
    }

    let channel0 = scalePeaksToDisplay(audioPeaks[0]);

    if (channel0.length < expectedLength) {
      // Pad with zeros to prevent stretching
      const padding = new Array(expectedLength - channel0.length).fill(0);
      channel0 = channel0.concat(padding);
    } else if (channel0.length > expectedLength) {
      // Trim excess to prevent squeezing
      channel0 = channel0.slice(0, expectedLength);
    }

    return [channel0];
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

    if (e.ctrlKey) {
      const clickTime = this.calculateTimeFromMouseEvent(e, region.start);
      this.clipsStateService.splitClip(region.id, clickTime);
    } else {
      this.performSeekFromMouseEvent(region, e);
    }

    this.hideContextMenuRequested.emit();
  }

  private calculateTimeFromMouseEvent(e: MouseEvent, fallbackTime: number): number {
    const wrapper = this.wavesurfer?.getWrapper();
    if (!wrapper) {
      return fallbackTime;
    }

    const bbox = wrapper.getBoundingClientRect();
    const progress = (e.clientX - bbox.left) / bbox.width;
    return progress * (this.wavesurfer?.getDuration() || 0);
  }

  private handleRegionCreated = (region: Region) => {
    const regionEl = region.element as HTMLElement;

    if (this.isCtrlPressed()) {
      const isGap = region.id.startsWith('gap-');
      regionEl.style.cursor = isGap ? 'no-drop' : 'col-resize';
    }

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
    const targetTime = this.calculateTimeFromMouseEvent(e, region.start);

    // Update visual indicator IMMEDIATELY for responsiveness
    this.wavesurfer?.setTime(targetTime);

    // Tell backend to seek
    this.videoStateService.seekAbsolute(targetTime);
  }

  private handleWaveSurferScroll = () => {
    if (this.scrollEventsToIgnore > 0) {
      this.scrollEventsToIgnore--;
      return;
    }
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
    if (!this.wsRegions) {
      return;
    }

    // Index existing regions for O(1) lookup
    const existingRegions = this.wsRegions.getRegions();
    const regionMap = new Map<string, Region>();
    existingRegions.forEach((r: Region) => regionMap.set(r.id, r));

    const processedIds = new Set<string>();

    clips.forEach(clip => {
      processedIds.add(clip.id);
      const existingRegion = regionMap.get(clip.id);
      const targetColor = clip.hasSubtitle ? this.inactiveSubtitleBg : this.gapBg;

      if (existingRegion) {
        // Update existing region (if it needs update) instead of recreating it
        const optionsToUpdate: any = {};
        let needsUpdate = false;

        if (Math.abs(existingRegion.start - clip.startTime) > 0.001) {
          optionsToUpdate.start = clip.startTime;
          needsUpdate = true;
        }

        if (Math.abs(existingRegion.end - clip.endTime) > 0.001) {
          optionsToUpdate.end = clip.endTime;
          needsUpdate = true;
        }

        if (existingRegion.color !== targetColor) {
          optionsToUpdate.color = targetColor;
          optionsToUpdate.resize = clip.hasSubtitle;
          needsUpdate = true;
        }

        if (needsUpdate) {
          existingRegion.setOptions(optionsToUpdate);
        }
      } else {
        // Create NEW region (only happens on load or split)
        this.wsRegions?.addRegion({
          id: clip.id,
          start: clip.startTime,
          end: clip.endTime,
          color: targetColor,
          drag: false,
          resize: clip.hasSubtitle
        });
      }
    });

    // Remove stale regions (deleted or merged)
    regionMap.forEach((region, id) => {
      if (!processedIds.has(id)) {
        region.remove();
      }
    });
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'Control') {
      this.isCtrlPressed.set(e.type === 'keydown');
    }
  }

  private updateRegionCursors(isCtrl: boolean): void {
    if (!this.wsRegions) {
      return;
    }

    this.wsRegions.getRegions().forEach(region => {
      const isGap = region.id.startsWith('gap-');
      const el = region.element;

      if (el) {
        if (isCtrl) {
          el.style.cursor = isGap ? 'no-drop' : 'col-resize';
        } else {
          el.style.cursor = 'default';
        }
      }
    });
  }
}
