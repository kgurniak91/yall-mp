import {Component, computed, effect, ElementRef, inject, input, OnDestroy, signal, viewChild} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle} from '../../../model/settings.types';
import ASS from 'assjs';
import {SubtitlesHighlighterService} from '../services/subtitles-highlighter/subtitles-highlighter.service';
import {distinctUntilChanged, fromEvent, map, merge, throttleTime} from 'rxjs';

@Component({
  selector: 'app-subtitles-overlay',
  imports: [],
  templateUrl: './subtitles-overlay.component.html',
  styleUrl: './subtitles-overlay.component.scss'
})
export class SubtitlesOverlayComponent implements OnDestroy {
  public readonly currentClip = input<VideoClip | undefined>();
  public readonly rawAssContent = input<string | undefined>();
  public readonly videoContainerElement = input<HTMLDivElement | undefined>();

  protected readonly shouldBeHidden = computed(() => {
    const style = this.globalSettingsStateService.hiddenSubtitleStyle();
    return !this.videoStateService.subtitlesVisible() && style === HiddenSubtitleStyle.Hidden;
  });

  protected readonly shouldBeBlurred = computed(() => {
    const style = this.globalSettingsStateService.hiddenSubtitleStyle();
    return !this.videoStateService.subtitlesVisible() && style === HiddenSubtitleStyle.Blurred;
  });

  protected readonly isWordHovered = signal(false);
  protected readonly videoStateService = inject(VideoStateService);
  private readonly subtitleContainer = viewChild.required<ElementRef<HTMLDivElement>>('subtitleContainer');
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private assInstance: ASS | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fakeVideo: any = null;

  constructor() {
    effect((onCleanup) => {
      const videoContainer = this.videoContainerElement();
      if (!videoContainer) return;

      this.resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        const {width, height} = entry.contentRect;

        if (width > 0 && height > 0) {
          this.initializeOrUpdateAssRenderer(width, height);
        }
      });
      this.resizeObserver.observe(videoContainer);

      onCleanup(() => {
        this.resizeObserver?.disconnect();
        this.destroyAssRenderer();
      });
    });

    effect(() => {
      const currentTime = this.videoStateService.currentTime();
      if (this.fakeVideo) {
        this.fakeVideo.currentTime = currentTime;
        this.fakeVideo.dispatchEvent(new Event('timeupdate'));
      }
    });

    effect(() => {
      const seekCompleted = this.videoStateService.seekCompleted();
      if (seekCompleted && this.assInstance && this.fakeVideo) {
        this.videoStateService.clearSeekCompleted();
        this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
      }
    });

    effect((onCleanup) => {
      const container = this.subtitleContainer()?.nativeElement;
      if (!container) return;

      const mouseMove$ = fromEvent<MouseEvent>(container, 'mousemove').pipe(
        throttleTime(50, undefined, {leading: true, trailing: true}),
        map(event => this.getWordRectFromEvent(event)),
        distinctUntilChanged((prev, curr) => prev?.left === curr?.left && prev?.top === curr?.top)
      );

      const mouseLeave$ = fromEvent(container, 'mouseleave').pipe(
        map(() => null)
      );

      const hoverSubscription = merge(mouseMove$, mouseLeave$).subscribe(rect => {
        if (rect) {
          this.subtitlesHighlighterService.show(rect);
          this.isWordHovered.set(true);
        } else {
          this.subtitlesHighlighterService.hide();
          this.isWordHovered.set(false);
        }
      });

      const handleInteraction = (event: MouseEvent) => this.handleSubtitleInteraction(event);
      container.addEventListener('mouseup', handleInteraction);

      onCleanup(() => {
        hoverSubscription.unsubscribe();
        container.removeEventListener('mouseup', handleInteraction);
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyAssRenderer();
  }

  protected onDoubleClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  private initializeOrUpdateAssRenderer(width: number, height: number): void {
    const assContent = this.rawAssContent();
    const renderContainer = this.subtitleContainer()?.nativeElement;
    const videoContainer = this.videoContainerElement();

    if (!assContent || !renderContainer || !videoContainer) {
      return;
    }

    this.destroyAssRenderer();

    this.fakeVideo = videoContainer;
    this.fakeVideo.videoWidth = width;
    this.fakeVideo.videoHeight = height;
    this.fakeVideo.currentTime = this.videoStateService.currentTime();
    this.fakeVideo.paused = this.videoStateService.isPaused();

    const originalAddEventListener = this.fakeVideo.addEventListener.bind(this.fakeVideo);

    this.fakeVideo.addEventListener = (event: string, handler: any) => {
      if (['playing', 'pause', 'seeking', 'timeupdate'].includes(event)) {
        originalAddEventListener(event, handler);
      }
    };

    this.fakeVideo.removeEventListener = () => {};

    const containerAspectRatio = width / height;
    const videoAspectRatio = 16 / 9; // A common default for video content
    const resamplingMode = containerAspectRatio > videoAspectRatio
      ? 'script_height' // The container is wider: scale by height and center.
      : 'script_width'; // The container is taller: scale by width and center.

    this.assInstance = new ASS(assContent, this.fakeVideo, {
      container: renderContainer,
      resampling: resamplingMode
    });

    setTimeout(() => {
      this.fakeVideo?.dispatchEvent(new Event('playing'));
    }, 0);
  }

  private destroyAssRenderer(): void {
    this.assInstance?.destroy();
    this.assInstance = null;
    this.fakeVideo = null;
  }

  private handleSubtitleInteraction(event: MouseEvent): void {
    const selection = window.getSelection();
    const container = this.subtitleContainer().nativeElement;

    // Case 1: The user has selected a phrase.
    if (selection && selection.toString().trim().length > 0) {
      if (selection.anchorNode && container.contains(selection.anchorNode)) {
        console.log(`User selected phrase: "${selection.toString().trim()}"`);
        // TODO handle dictionary lookup
      }
      return;
    }

    // Case 2: The user performed a simple click (no selection).
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (range && container.contains(range.startContainer)) {
      const word = this.getWordFromRange(range);
      if (word) {
        console.log(`User clicked word: "${word}"`);
        // TODO handle dictionary lookup
      }
    }
  }

  private getWordFromRange(range: Range): string | null {
    const boundaries = this.getWordBoundaries(range.startContainer, range.startOffset);
    if (!boundaries || !range.startContainer.textContent) {
      return null;
    }
    return range.startContainer.textContent.substring(boundaries.start, boundaries.end);
  }

  private getWordRectFromEvent(event: MouseEvent): DOMRect | null {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    const textNode = range?.startContainer;
    const container = this.subtitleContainer()?.nativeElement;

    if (!range || !textNode || !container || !container.contains(textNode)) {
      return null;
    }

    const boundaries = this.getWordBoundaries(textNode, range.startOffset);
    if (!boundaries) {
      return null;
    }

    const wordRange = document.createRange();
    wordRange.setStart(textNode, boundaries.start);
    wordRange.setEnd(textNode, boundaries.end);

    const candidateRect = wordRange.getBoundingClientRect();

    // Check if the actual mouse coordinates are within the bounds of the found word's rectangle.
    const isCursorInsideRect = (
      event.clientX >= candidateRect.left &&
      event.clientX <= candidateRect.right &&
      event.clientY >= candidateRect.top &&
      event.clientY <= candidateRect.bottom
    );

    // Only return the rectangle if the cursor is physically inside it. This prevents "phantom" highlights.
    return isCursorInsideRect ? candidateRect : null;
  }

  private getWordBoundaries(textNode: Node, offset: number): { start: number, end: number } | null {
    if (textNode.nodeType !== Node.TEXT_NODE || !textNode.textContent) {
      return null;
    }
    const textContent = textNode.textContent;

    let start = offset;
    while (start > 0 && /\p{L}|\p{N}|'|-/u.test(textContent[start - 1])) {
      start--;
    }

    let end = offset;
    while (end < textContent.length && /\p{L}|\p{N}|'|-/u.test(textContent[end])) {
      end++;
    }

    // No word characters were found at the cursor's position
    if (start === end) {
      return null;
    }

    return {start, end};
  }
}
