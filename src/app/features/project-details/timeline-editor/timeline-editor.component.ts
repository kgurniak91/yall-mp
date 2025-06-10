import {Component, effect, ElementRef, inject, OnDestroy, viewChild} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {Region} from 'wavesurfer.js/dist/plugins/regions.js';
import {VideoStateService} from '../../../state/video-state.service';

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

  ngOnDestroy() {
    this.wavesurfer?.destroy();
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
