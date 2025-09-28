import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle} from '../../../model/settings.types';
import {ProjectSettingsStateService} from '../../../state/project-settings/project-settings-state.service';
import ASS from 'assjs';
import {SubtitlesHighlighterService} from '../services/subtitles-highlighter/subtitles-highlighter.service';
import {distinctUntilChanged, filter, fromEvent, map, merge, pairwise, throttleTime} from 'rxjs';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';

const FALLBACK_VIDEO_ASPECT_RATIO = 16 / 9;

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
  public readonly videoWidth = input<number | undefined>();
  public readonly videoHeight = input<number | undefined>();

  protected readonly shouldBeHidden = computed(() => {
    if (!this.currentClip()?.hasSubtitle) {
      return true;
    }

    if (this.rawAssContent()) {
      if (this.projectSettingsStateService.useMpvSubtitles()) {
        // User switched to native MPV subtitles, hide interactive subtitles layer
        return true;
      }

      if (!this.isScaleApplied()) {
        // Interactive subtitles not initialized yet, they need to be scaled first
        return true;
      }
    }

    const shouldBeHidden = !this.videoStateService.subtitlesVisible()
      && (this.globalSettingsStateService.hiddenSubtitleStyle() === HiddenSubtitleStyle.Hidden);

    return shouldBeHidden || this.videoStateService.isBusy();
  });

  protected readonly shouldBeBlurred = computed(() => {
    const style = this.globalSettingsStateService.hiddenSubtitleStyle();
    return !this.videoStateService.subtitlesVisible() && style === HiddenSubtitleStyle.Blurred;
  });

  protected readonly isWordHovered = signal(false);
  protected readonly videoStateService = inject(VideoStateService);
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly subtitleContainer = viewChild.required<ElementRef<HTMLDivElement>>('subtitleContainer');
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isInitialized = signal(false);
  private readonly isScaleApplied = signal(false);
  private assInstance: ASS | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private fakeVideo: any = null;
  private readonly isSelecting = signal(false);
  private selectionAnchor: { node: Node, start: number, end: number } | null = null;
  private selectionFocus: { node: Node, start: number, end: number } | null = null;
  private interactiveTextNodes: Node[] = [];
  private readonly baseAssScale = signal(1.0, {
    equal: () => false // Always update, even if the same value is provided twice in a row
  });

  constructor() {
    effect(() => {
      if (this.videoStateService.assRendererSyncRequest()) {
        if (this.assInstance && this.fakeVideo) {
          console.log('[SubtitlesOverlay] Received explicit request to sync ASS renderer.');
          this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
        }
        this.videoStateService.clearAssRendererSyncRequest();
      }
    });

    effect(() => {
      const baseScale = this.baseAssScale();
      const settings = this.projectSettingsStateService.settings();

      if (settings.useMpvSubtitles) {
        if (!this.rawAssContent()) {
          this.isScaleApplied.set(true); // SRT has always the correct scale applied
        }
        return;
      }

      const percentage = settings.assScalePercentage;
      if (typeof percentage !== 'number') {
        // Exhaustive check just in case
        return;
      }

      const multiplier = percentage / 100;
      const finalScale = baseScale * multiplier;

      const container = this.subtitleContainer()?.nativeElement;
      const assBox = container?.querySelector('.ASS-box') as HTMLElement | null;

      if (assBox) {
        assBox.style.setProperty('--ass-scale', finalScale.toString(), 'important');
        assBox.style.setProperty('--ass-scale-stroke', finalScale.toString(), 'important');
      }

      this.isScaleApplied.set(true);
      this.subtitleContainer().nativeElement.classList.remove('subtitles-initializing');
    });

    toObservable(this.projectSettingsStateService.useMpvSubtitles).pipe(
      pairwise(), // Emits [previousValue, currentValue]
      filter(([prev, curr]) => prev === true && curr === false), // Trigger only when switching MPV -> ASS.js
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      if (this.fakeVideo) {
        console.log('[SubtitlesOverlay] Switched to ASS.js renderer. Forcing re-initialization.');
        this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
      }
    });

    effect((onCleanup) => {
      const videoContainer = this.videoContainerElement();
      const subtitleContainer = this.subtitleContainer();
      const rawAssContent = this.rawAssContent();

      if (!videoContainer || !subtitleContainer || !rawAssContent) {
        return;
      }

      this.resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        const {width, height} = entry.contentRect;

        if (width > 0 && height > 0) {
          this.initializeOrUpdateAssRenderer(width, height);
          this.isInitialized.set(true);
        }
      });
      this.resizeObserver.observe(videoContainer);

      onCleanup(() => {
        this.isInitialized.set(false);
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
      if (seekCompleted) {
        this.videoStateService.clearSeekCompleted();
        if (!this.projectSettingsStateService.useMpvSubtitles() && this.assInstance && this.fakeVideo) {
          this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
        }
      }
    });

    effect((onCleanup) => {
      const container = this.subtitleContainer()?.nativeElement;
      if (!container) return;

      const mouseMove$ = fromEvent<MouseEvent>(container, 'mousemove').pipe(
        filter(() => !this.projectSettingsStateService.useMpvSubtitles()),
        filter(() => !this.isSelecting()),
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

      const handleMouseDown = (event: MouseEvent) => this.handleMouseDown(event);
      const handleMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
      const handleMouseUp = (event: MouseEvent) => this.handleMouseUp(event);

      container.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      this.mutationObserver?.disconnect();
      this.mutationObserver = new MutationObserver(() => {
        this.updateInteractiveTextNodes();
      });
      this.mutationObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      onCleanup(() => {
        hoverSubscription.unsubscribe();
        container.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        this.mutationObserver?.disconnect();
      });
    });

    effect(() => {
      if (this.projectSettingsStateService.useMpvSubtitles()) {
        this.subtitlesHighlighterService.hide();
      }
    });

    effect(() => {
      this.rawAssContent();

      untracked(() => {
        if (this.assInstance && this.videoContainerElement() && this.fakeVideo) {
          console.log('[SubtitlesOverlay] rawAssContent has changed. Forcing re-initialization of ass.js renderer.');
          this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
        }
      });
    });

    effect(() => {
      const clip = this.currentClip();
      const container = this.subtitleContainer()?.nativeElement;

      if (!container) {
        return;
      }

      if (clip?.hasSubtitle && this.rawAssContent()) {
        // Remove any stale DOM nodes from the previous clip or project.
        container.innerHTML = '';

        untracked(() => {
          if (this.isInitialized() && this.fakeVideo) {
            this.initializeOrUpdateAssRenderer(this.fakeVideo.videoWidth, this.fakeVideo.videoHeight);
          }
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyAssRenderer();
    this.mutationObserver?.disconnect();
  }

  protected onDoubleClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  private initializeOrUpdateAssRenderer(width: number, height: number): void {
    const renderContainer = this.subtitleContainer()?.nativeElement;
    if (renderContainer) {
      renderContainer.innerHTML = ''; // Clean-up just in case
    }

    this.subtitleContainer().nativeElement.classList.add('subtitles-initializing');
    const assContent = this.rawAssContent();
    const videoContainer = this.videoContainerElement();

    if (!assContent || !renderContainer || !videoContainer) {
      if (!assContent) {
        this.isScaleApplied.set(true); // SRT has always the correct scale applied
      }
      return;
    }

    this.isScaleApplied.set(false);
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

    this.fakeVideo.removeEventListener = () => {
    };

    const containerAspectRatio = width / height;
    const videoWidth = this.videoWidth();
    const videoHeight = this.videoHeight();
    const videoAspectRatio = (videoWidth && videoHeight && (videoHeight > 0)) ? (videoWidth / videoHeight) : FALLBACK_VIDEO_ASPECT_RATIO;
    const resamplingMode = (containerAspectRatio > videoAspectRatio)
      ? 'script_height' // The container is wider: scale by height and center.
      : 'script_width'; // The container is taller: scale by width and center.

    this.assInstance = new ASS(assContent, this.fakeVideo, {
      container: renderContainer,
      resampling: resamplingMode
    });

    setTimeout(() => {
      this.fakeVideo?.dispatchEvent(new Event('playing'));

      // Give ass.js enough time to finish its own internal async CSS variables updates:
      requestAnimationFrame(() => {
        const assBox = renderContainer.querySelector('.ASS-box');
        if (assBox) {
          const newBaseScale = parseFloat(getComputedStyle(assBox).getPropertyValue('--ass-scale'));
          if (!isNaN(newBaseScale) && newBaseScale > 0) {
            this.baseAssScale.set(newBaseScale);
          }
        }
      });
    }, 0);
  }

  private destroyAssRenderer(): void {
    this.assInstance?.destroy();
    this.assInstance = null;
    this.fakeVideo = null;

    const container = this.subtitleContainer()?.nativeElement;
    if (container) {
      container.innerHTML = '';
    }
  }

  private getWordRectFromEvent(event: MouseEvent): DOMRect | null {
    const wordInfo = this.getWordInfoFromEvent(event);
    if (!wordInfo) {
      return null;
    }

    const wordRange = document.createRange();
    wordRange.setStart(wordInfo.node, wordInfo.start);
    wordRange.setEnd(wordInfo.node, wordInfo.end);

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

  private handleMouseDown(event: MouseEvent): void {
    if (this.projectSettingsStateService.useMpvSubtitles() || event.button !== 0) {
      return;
    }

    const wordInfo = this.getWordInfoFromEvent(event);
    const container = this.subtitleContainer().nativeElement;

    if (wordInfo && container.contains(wordInfo.node)) {
      event.preventDefault();
      this.isSelecting.set(true);
      this.selectionAnchor = wordInfo;
      this.selectionFocus = wordInfo;
      this.updateSelectionHighlight();
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isSelecting()) {
      return;
    }
    event.preventDefault();

    const wordInfo = this.getWordInfoFromEvent(event);
    if (wordInfo) {
      if (wordInfo.node !== this.selectionFocus?.node || wordInfo.start !== this.selectionFocus?.start) {
        this.selectionFocus = wordInfo;
        this.updateSelectionHighlight();
      }
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (!this.isSelecting()) {
      return;
    }
    event.preventDefault();

    const selectedText = this.getSelectedText().trim();
    const wasSimpleClick = this.selectionAnchor?.node === this.selectionFocus?.node &&
      this.selectionAnchor?.start === this.selectionFocus?.start;

    if (wasSimpleClick && selectedText) {
      console.log(`User clicked word: "${selectedText}"`);
    } else if (selectedText) {
      console.log(`User selected phrase: "${selectedText}"`);
    }

    this.isSelecting.set(false);
    this.selectionAnchor = null;
    this.selectionFocus = null;

    const rect = this.getWordRectFromEvent(event);
    if (rect) {
      this.subtitlesHighlighterService.show(rect);
    } else {
      this.subtitlesHighlighterService.hide();
    }
  }

  private getWordInfoFromEvent(event: MouseEvent): { node: Node, start: number, end: number } | null {
    for (const node of this.interactiveTextNodes) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      const isWithinNode = rects.some(r =>
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      );

      if (isWithinNode) {
        const tempRange = document.caretRangeFromPoint(event.clientX, event.clientY);
        if (tempRange) {
          const boundaries = this.getWordBoundaries(node, tempRange.startOffset);
          if (boundaries) {
            return {node, ...boundaries};
          }
        }
      }
    }

    return null;
  }

  private updateSelectionHighlight(): void {
    const selection = this.getOrderedSelection();
    if (!selection) {
      this.subtitlesHighlighterService.hide();
      return;
    }

    const {start, end, startIndex, endIndex} = selection;

    const rects: DOMRect[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const currentNode = this.interactiveTextNodes[i];
      const range = document.createRange();

      const startOffset = (i === startIndex) ? start.offset : 0;
      const endOffset = (i === endIndex) ? end.offset : (currentNode.textContent?.length || 0);

      if (startOffset < endOffset) {
        range.setStart(currentNode, startOffset);
        range.setEnd(currentNode, endOffset);
        Array.from(range.getClientRects()).forEach(rect => rects.push(rect));
      }
    }
    this.subtitlesHighlighterService.show(rects);
  }

  private getSelectedText(): string {
    const selection = this.getOrderedSelection();
    if (!selection) {
      return '';
    }

    // Manual string construction to avoid traversing the DOM with all its layers.
    const {start, end, startIndex, endIndex} = selection;
    const selectedParts: string[] = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const currentNode = this.interactiveTextNodes[i];
      const textContent = currentNode.textContent || '';

      if (startIndex === endIndex) {
        // Selection is within a single node.
        selectedParts.push(textContent.substring(start.offset, end.offset));
      } else if (i === startIndex) {
        // First node in a multi-node selection.
        selectedParts.push(textContent.substring(start.offset));
      } else if (i === endIndex) {
        // Last node in a multi-node selection.
        selectedParts.push(textContent.substring(0, end.offset));
      } else {
        // A full node in the middle of the selection.
        selectedParts.push(textContent);
      }
    }

    return selectedParts.join(' ');
  }

  private getAllTextNodes(root: HTMLElement): Node[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim()) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private getUniqueVisibleTextNodes(root: HTMLElement): Node[] {
    const allNodes = this.getAllTextNodes(root);
    const nodeMap = new Map<string, Node>();

    for (const node of allNodes) {
      const range = document.createRange();
      range.selectNode(node);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) continue;

      const key = `${rect.top.toFixed(0)},${rect.left.toFixed(0)},${rect.width.toFixed(0)},${rect.height.toFixed(0)},${node.textContent}`;
      nodeMap.set(key, node);
    }
    return Array.from(nodeMap.values());
  }

  private getOrderedSelection() {
    if (!this.selectionAnchor || !this.selectionFocus) {
      return null;
    }

    const anchorIndex = this.interactiveTextNodes.indexOf(this.selectionAnchor.node);
    const focusIndex = this.interactiveTextNodes.indexOf(this.selectionFocus.node);

    if (anchorIndex === -1 || focusIndex === -1) {
      return null;
    }

    const anchorIsBeforeFocus = anchorIndex < focusIndex ||
      (anchorIndex === focusIndex && this.selectionAnchor.start <= this.selectionFocus.start);

    const start = anchorIsBeforeFocus
      ? {node: this.selectionAnchor.node, offset: this.selectionAnchor.start}
      : {node: this.selectionFocus.node, offset: this.selectionFocus.start};

    const end = anchorIsBeforeFocus
      ? {node: this.selectionFocus.node, offset: this.selectionFocus.end}
      : {node: this.selectionAnchor.node, offset: this.selectionAnchor.end};

    return {
      start,
      end,
      startIndex: Math.min(anchorIndex, focusIndex),
      endIndex: Math.max(anchorIndex, focusIndex)
    };
  }

  private updateInteractiveTextNodes(): void {
    const container = this.subtitleContainer()?.nativeElement;
    if (container) {
      this.interactiveTextNodes = this.getUniqueVisibleTextNodes(container);
    }
  }
}
