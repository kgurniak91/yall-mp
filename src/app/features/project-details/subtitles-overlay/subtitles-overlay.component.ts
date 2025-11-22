import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {PlayerState, VideoClip} from '../../../model/video.types';
import {ProjectSettingsStateService} from '../../../state/project-settings/project-settings-state.service';
import ASS from 'assjs';
import {SubtitlesHighlighterService} from '../services/subtitles-highlighter/subtitles-highlighter.service';
import {distinctUntilChanged, filter, fromEvent, map, merge, pairwise, throttleTime} from 'rxjs';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {TokenizationService} from '../services/tokenization/tokenization.service';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';

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
  public readonly isContextMenuOpen = input.required<boolean>();
  public readonly contextMenuRequested = output<{ event: MouseEvent, text: string }>();
  public readonly defaultActionRequested = output<string>();
  private lastMouseEvent: MouseEvent | null = null;

  protected readonly shouldBeHidden = computed(() => {
    if (this.videoStateService.playerState() === PlayerState.Seeking) {
      return true;
    }

    if (!this.currentClip()?.hasSubtitle) {
      return true;
    }

    if (!this.videoStateService.isVideoWindowVisible()) {
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

    return !this.videoStateService.subtitlesVisible() || this.videoStateService.isBusy();
  });

  protected readonly isWordHovered = signal(false);
  protected readonly videoStateService = inject(VideoStateService);
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly subtitleContainer = viewChild.required<ElementRef<HTMLDivElement>>('subtitleContainer');
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private readonly tokenizationService = inject(TokenizationService);
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
        filter(() => !this.isContextMenuOpen()),
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
          this.showHighlight(rect);
          this.isWordHovered.set(true);
        } else {
          this.subtitlesHighlighterService.hide();
          this.isWordHovered.set(false);
        }
      });

      const handleMouseDown = (event: MouseEvent) => this.handleMouseDown(event);
      const handleMouseMove = (event: MouseEvent) => {
        this.lastMouseEvent = event;
        this.handleMouseMove(event);
      };
      const handleMouseUp = (event: MouseEvent) => this.handleMouseUp(event);
      const handleContextMenu = (event: MouseEvent) => this.handleContextMenu(event);
      const handleKeyChange = (event: KeyboardEvent) => {
        if (event.key === 'Control' && this.lastMouseEvent && !this.isSelecting()) {
          // Use coordinates from the last known mouse position, but the 'ctrlKey' flag from the current keyboard event.
          // Thanks to this user can toggle between selecting single character and word/phrase without moving the mouse.
          const syntheticEvent = new MouseEvent('mousemove', {
            clientX: this.lastMouseEvent.clientX,
            clientY: this.lastMouseEvent.clientY,
            ctrlKey: event.ctrlKey
          });

          const rect = this.getWordRectFromEvent(syntheticEvent);

          if (rect) {
            this.showHighlight(rect);
            this.isWordHovered.set(true);
          } else {
            this.subtitlesHighlighterService.hide();
            this.isWordHovered.set(false);
          }
        }
      };

      container.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('contextmenu', handleContextMenu);
      document.addEventListener('keydown', handleKeyChange);
      document.addEventListener('keyup', handleKeyChange);

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
        document.removeEventListener('contextmenu', handleContextMenu);
        document.removeEventListener('keydown', handleKeyChange);
        document.removeEventListener('keyup', handleKeyChange);
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

  onSubtitleContainerClick(event: MouseEvent): void {
    // Check if the click event originated on an actual word
    const wordInfo = this.getWordInfoFromEvent(event);

    if (wordInfo) {
      // If a word was clicked, stop the event, to prevent it from toggling play/pause
      event.stopPropagation();
    }
  }

  private showHighlight(rects: DOMRect | DOMRect[]): void {
    const container = this.videoContainerElement();
    if (!container) {
      this.subtitlesHighlighterService.show(rects);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rectArray = Array.isArray(rects) ? rects : [rects];

    const trimmedRects = rectArray
      .map(rect => this.intersectRect(rect, containerRect))
      .filter((rect): rect is DOMRect => rect !== null);

    this.subtitlesHighlighterService.show(trimmedRects);
  }

  private intersectRect(r1: DOMRect, r2: DOMRect): DOMRect | null {
    const left = Math.max(r1.left, r2.left);
    const top = Math.max(r1.top, r2.top);
    const right = Math.min(r1.right, r2.right);
    const bottom = Math.min(r1.bottom, r2.bottom);

    if (right > left && bottom > top) {
      return new DOMRect(left, top, right - left, bottom - top);
    }
    return null;
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

    requestAnimationFrame(() => {
      this.fakeVideo?.dispatchEvent(new Event('playing'));

      // Give ass.js enough time to finish its own internal async CSS variables updates:
      requestAnimationFrame(() => {
        const assBox = renderContainer.querySelector('.ASS-box');
        if (assBox) {
          const newBaseScale = parseFloat(getComputedStyle(assBox).getPropertyValue('--ass-scale'));
          if (!isNaN(newBaseScale) && newBaseScale > 0) {
            this.baseAssScale.set(newBaseScale);
          } else {
            this.isScaleApplied.set(true);
            this.subtitleContainer().nativeElement.classList.remove('subtitles-initializing');
          }
        } else {
          this.isScaleApplied.set(true);
          this.subtitleContainer().nativeElement.classList.remove('subtitles-initializing');
        }
      });
    });
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
    const nodeLength = wordInfo.node.textContent?.length ?? 0;
    if (wordInfo.start > nodeLength || wordInfo.end > nodeLength) {
      console.warn('Stale word info detected in getWordRectFromEvent. Aborting highlight.');
      return null;
    }

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
    const textContent = textNode.textContent || '';
    return this.tokenizationService.getWordBoundaries(textContent, offset);
  }

  private handleMouseDown(event: MouseEvent): void {
    if (this.projectSettingsStateService.useMpvSubtitles() || event.button !== 0) {
      return;
    }

    const wordInfo = this.getWordInfoFromEvent(event);
    const container = this.subtitleContainer().nativeElement;

    if (wordInfo && container.contains(wordInfo.node)) {
      // Auto-pause the video if it's playing
      if (!this.videoStateService.isPaused()) {
        this.videoStateService.togglePlayPause();
      }

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

    if (event.button !== 0) {
      // If it was another mouse button, just cancel the selection
      this.isSelecting.set(false);
      this.selectionAnchor = null;
      this.selectionFocus = null;
      this.subtitlesHighlighterService.hide();
      return;
    }

    event.preventDefault();

    const selectedText = this.getSelectedText().trim();
    const wasSimpleClick = (this.selectionAnchor?.node === this.selectionFocus?.node) &&
      (this.selectionAnchor?.start === this.selectionFocus?.start);

    if (selectedText) {
      if (wasSimpleClick) {
        this.defaultActionRequested.emit(selectedText);
      } else {
        this.contextMenuRequested.emit({event, text: selectedText});
      }
    }

    this.isSelecting.set(false);
    this.selectionAnchor = null;
    this.selectionFocus = null;

    if (wasSimpleClick) {
      // If it was a simple click (default action), immediately restore the hover highlight because no menu is covering it:
      const rect = this.getWordRectFromEvent(event);
      if (rect) {
        this.showHighlight(rect);
      } else {
        this.subtitlesHighlighterService.hide();
      }
    } else {
      // If it was a multi-word drag, a context menu has been opened - hide the highlight:
      this.subtitlesHighlighterService.hide();
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.projectSettingsStateService.useMpvSubtitles()) {
      return;
    }

    let textForMenu = '';

    if (this.isSelecting()) {
      // If drag-selection is currently active, the selected text is the phrase the user has highlighted:
      textForMenu = this.getSelectedText().trim();
    } else {
      // If not, it's a simple right-click - find the single word under the cursor:
      const wordInfo = this.getWordInfoFromEvent(event);
      if (wordInfo && wordInfo.node.textContent) {
        textForMenu = wordInfo.node.textContent.substring(wordInfo.start, wordInfo.end);
      }
    }

    if (!textForMenu?.trim()?.length) {
      return;
    }

    event.preventDefault();

    // Auto-pause the video if it's playing
    if (!this.videoStateService.isPaused()) {
      this.videoStateService.togglePlayPause();
    }

    this.contextMenuRequested.emit({event, text: textForMenu});
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
          const text = node.textContent || '';
          const offset = tempRange.startOffset;

          // If Ctrl is held, bypass tokenization and select single character
          if (event.ctrlKey) {
            // Ensure cursor is not outside bounds or at empty text
            if (offset < text.length) {
              // Ensure cursor is not at whitespace
              if (/\s/.test(text[offset])) {
                return null;
              }

              return {
                node,
                start: offset,
                end: offset + 1
              };
            }
          }

          const boundaries = this.getWordBoundaries(node, offset);
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

      const currentNodeLength = currentNode.textContent?.length || 0;
      const startOffset = (i === startIndex) ? start.offset : 0;
      const endOffset = (i === endIndex) ? end.offset : currentNodeLength;

      if (startOffset > currentNodeLength || endOffset > currentNodeLength) {
        console.warn('Stale selection info detected in updateSelectionHighlight. Skipping a highlight rectangle.');
        continue;
      }
      if (startOffset < endOffset) {
        range.setStart(currentNode, startOffset);
        range.setEnd(currentNode, endOffset);
        Array.from(range.getClientRects()).forEach(rect => rects.push(rect));
      }
    }
    this.showHighlight(rects);
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
