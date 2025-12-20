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
import {debounce, EMPTY, filter, of, pairwise, Subject, switchMap, timer} from 'rxjs';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {TokenizationService} from '../services/tokenization/tokenization.service';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {YomitanPopupComponent} from '../yomitan-popup/yomitan-popup.component';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';
import {NoteRequest} from './subtitles-overlay.types';
import {DialogService} from 'primeng/dynamicdialog';

const FALLBACK_VIDEO_ASPECT_RATIO = 16 / 9;

@Component({
  selector: 'app-subtitles-overlay',
  imports: [
    YomitanPopupComponent
  ],
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
  public readonly isYomitanEnabled = input<boolean>(false);
  public readonly contextMenuRequested = output<{ event: MouseEvent, text: string }>();
  public readonly defaultActionRequested = output<string>();
  public readonly noteRequest = output<NoteRequest>();
  public readonly closeContextMenu = output<void>();
  public readonly popupShown = output<void>();
  private readonly dialogService = inject(DialogService);

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
  protected readonly currentSearchTerm = signal<string | null>(null);
  protected readonly activeTerms = computed(() => {
    const term = this.currentSearchTerm();
    return term ? [term] : [];
  });
  protected readonly popupPosition = signal<{
    left: number,
    top?: number,
    bottom?: number,
    maxHeight: number
  } | null>(null);
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private readonly subtitleContainer = viewChild.required<ElementRef<HTMLDivElement>>('subtitleContainer');
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private readonly tokenizationService = inject(TokenizationService);
  private readonly yomitanService = inject(YomitanService);
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
  private readonly hoverSubject = new Subject<{
    event: MouseEvent,
    textNode: Node,
    offset: number,
    isImmediate?: boolean
  } | null>();
  private currentHighlight: { node: Node, start: number, end: number } | null = null;
  private shouldPreventVideoToggle = false;
  private isHoverBlocked = false;
  private lastYomitanHighlight: { node: Node, start: number, end: number } | null = null;
  private lastMouseEvent: MouseEvent | null = null;
  private lastLogicalHit: { node: Node, offset: number, ctrlKey: boolean } | null = null;
  private readonly HEADER_SAFE_ZONE = 50;

  constructor() {
    effect(() => {
      this.isContextMenuOpen();
      this.isHoverBlocked = false;
    });

    effect((onCleanup) => {
      const clearState = () => {
        untracked(() => {
          if (this.currentSearchTerm() || this.currentHighlight) {
            this.clearHighlightAndPopup();
          }
        });
      };

      const cleanupMoveListener = window.electronAPI.onMainWindowMovedOrResized(() => clearState());
      const cleanupFullScreenListener = window.electronAPI.onWindowFullScreenStateChanged(() => clearState());
      const cleanupMaximizedListener = window.electronAPI.onWindowMaximizedStateChanged(() => clearState());

      onCleanup(() => {
        cleanupMoveListener();
        cleanupFullScreenListener();
        cleanupMaximizedListener();
      });
    });

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

          // Close offline dictionary popup on window resize
          if (this.currentSearchTerm()) {
            this.clearHighlightAndPopup();
          }
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

    this.hoverSubject.pipe(
      debounce(data => {
        if (!data) {
          // If popup IS open, keep the 200ms sticky delay to allow moving mouse to popup
          return this.currentSearchTerm() ? timer(200) : timer(0);
        }

        // Keyboard modifiers like CTRL are always instant
        if (data.isImmediate) {
          return timer(0);
        }

        // If a popup is ALREADY open, debounce (200ms) to allow moving mouse to the popup without accidentally triggering neighbors
        if (this.currentSearchTerm()) {
          return timer(200);
        }

        // If no popup is open (first hover), trigger instantly
        return timer(0);
      }),
      switchMap(data => {
        if (!data) {
          // Only be "Sticky" if a popup is actually open
          if (this.currentSearchTerm()) {
            return EMPTY;
          }

          // If no popup is open (just a highlight), return null to trigger a clear
          return of(null);
        }

        if (!this.isYomitanEnabled()) {
          return of({data, yomitan: null, scanStart: data.offset});
        }

        const fullText = data.textNode.textContent || '';
        let scanStart = data.offset;

        if (!data.event.ctrlKey) {
          const currentLang = this.projectSettingsStateService.subtitlesLanguage();
          const characterResolutionLangs = ['ja', 'zh', 'yue'];

          if (!characterResolutionLangs.includes(currentLang)) {
            const boundaries = this.tokenizationService.getWordBoundaries(fullText, data.offset);

            if (boundaries) {
              scanStart = boundaries.start;
            } else {
              return EMPTY;
            }
          }
        }

        let textToScan = fullText.substring(scanStart);

        if (data.event.ctrlKey) {
          const chars = Array.from(textToScan);
          textToScan = chars.length > 0 ? chars[0] : '';
        }

        if (!textToScan.trim()) {
          return EMPTY;
        }

        return this.yomitanService.findTerms(textToScan).then(result => {
          return {data, yomitan: result, scanStart};
        }).catch(err => {
          console.error(err);
          return {data, yomitan: null, scanStart};
        });
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      // Clear highlights when no popup is active
      if (!result) {
        this.clearHighlightAndPopup();
        return;
      }

      const {data, yomitan, scanStart} = result;
      this.handleHoverResult(data.event, data.textNode, data.offset, yomitan, scanStart);
    });

    effect((onCleanup) => {
      const container = this.subtitleContainer()?.nativeElement;
      if (!container) {
        return;
      }

      const handleMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
      const handleMouseDown = (event: MouseEvent) => this.handleMouseDown(event);
      const handleMouseUp = (event: MouseEvent) => this.handleMouseUp(event);
      const handleContextMenu = (event: MouseEvent) => this.handleContextMenu(event);
      const handleKeyChange = (event: KeyboardEvent) => this.handleKeyChange(event);
      const handleGlobalMouseDown = (event: MouseEvent) => this.handleGlobalMouseDown(event, container);

      container.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousedown', handleGlobalMouseDown);
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
        container.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousedown', handleGlobalMouseDown);
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
        this.popupPosition.set(null);
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
      untracked(() => this.clearHighlightAndPopup());
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

  public showOfflinePopupFor(text: string, event: MouseEvent) {
    this.clearHighlightAndPopup();
    this.currentSearchTerm.set(text);

    const viewportHeight = window.innerHeight;
    const gap = 8;
    const mouseY = event.clientY;

    const effectiveTop = this.HEADER_SAFE_ZONE;

    // Space available above the cursor, stopping at the header
    const spaceAbove = mouseY - effectiveTop;
    const spaceBelow = viewportHeight - mouseY;

    let top: number | undefined;
    let bottom: number | undefined;
    let maxHeight: number;

    if (spaceAbove > spaceBelow) {
      // Position ABOVE
      bottom = viewportHeight - mouseY + gap;
      maxHeight = spaceAbove - gap;
    } else {
      // Position BELOW
      top = mouseY + gap;
      maxHeight = spaceBelow - gap;
    }

    const left = event.clientX;
    this.popupPosition.set({left, top, bottom, maxHeight});
    this.popupShown.emit();
  }

  onSubtitleContainerClick(event: MouseEvent): void {
    if (this.shouldPreventVideoToggle) {
      event.stopPropagation();
      this.shouldPreventVideoToggle = false;
    }
  }

  onAddToNotes(noteContent: string) {
    const searchTerm = this.currentSearchTerm();
    if (searchTerm) {
      this.noteRequest.emit({
        term: searchTerm,
        text: noteContent
      });
    }
  }

  private handleHoverResult(event: MouseEvent, node: Node, offset: number, yomitanResult: any, scanStart: number) {
    if (
      this.isContextMenuOpen() ||
      this.isHoverBlocked ||
      (this.dialogService.dialogComponentRefMap.size > 0) ||
      this.projectSettingsStateService.isSettingsDrawerOpen()
    ) {
      // If results arrived after opening menu, dialog, drawer etc. - abort
      return;
    }

    let highlightStart = offset;
    let highlightEnd = offset;
    const hasYomitanResult = yomitanResult && yomitanResult.result && (yomitanResult.result.dictionaryEntries.length > 0);

    if (hasYomitanResult) {
      const matchLength = yomitanResult.result.originalTextLength;

      highlightStart = scanStart;
      highlightEnd = scanStart + matchLength;

      const fullText = node.textContent || '';
      const matchedText = fullText.substring(scanStart, scanStart + matchLength);

      this.currentSearchTerm.set(matchedText);

      const range = document.createRange();
      const safeEnd = Math.min(highlightEnd, node.textContent?.length || 0);
      range.setStart(node, highlightStart);
      range.setEnd(node, safeEnd);

      const rect = range.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const gap = 8;

      // Account for the header at the top of the screen
      const effectiveTop = this.HEADER_SAFE_ZONE;

      // Space available above the text, stopping at the header
      const spaceAbove = rect.top - effectiveTop;
      const spaceBelow = viewportHeight - rect.bottom;

      let top: number | undefined;
      let bottom: number | undefined;
      let maxHeight: number;

      // Prefer placing above if there is more space there, or if text is low on screen
      if (spaceAbove > spaceBelow) {
        // Position ABOVE
        bottom = viewportHeight - rect.top + gap;
        maxHeight = spaceAbove - gap;
      } else {
        // Position BELOW
        top = rect.bottom + gap;
        maxHeight = spaceBelow - gap;
      }

      const left = rect.left + (rect.width / 2);

      this.popupPosition.set({left, top, bottom, maxHeight});

      this.popupShown.emit();
    } else {
      // If Yomitan is enabled but found nothing, do NOT show a fallback highlight (prevents confusing highlights with no popups)...
      // ...but if CTRL is held, allow the fallback highlighting (visual feedback for "Click to Lookup")
      if (this.isYomitanEnabled() && !event.ctrlKey) {
        return;
      }

      // Fallback: when Yomitan is not configured for the current project, check tokenizer for a generic word
      const boundaries = this.getWordInfoFromEvent(event);

      if (boundaries) {
        // Tokenizer found a word (that isn't in Yomitan) - highlight but without popup
        highlightStart = boundaries.start;
        highlightEnd = boundaries.end;

        this.currentSearchTerm.set(null);
        this.popupPosition.set(null);
      } else {
        // Tokenizer also found no matches (e.g. punctuation or symbol like "(" or ")").
        // Treat this as "Sticky" empty space: keep the previous state (highlight + popup) visible.
        return;
      }
    }

    if (highlightEnd > highlightStart) {
      this.drawHighlight(node, highlightStart, highlightEnd);
      this.isWordHovered.set(true);
    }
  }

  private drawHighlight(node: Node, start: number, end: number) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const rects = Array.from(range.getClientRects());
    this.showHighlight(rects);
    this.currentHighlight = {node, start, end};
  }

  public clearHighlightAndPopup() {
    this.subtitlesHighlighterService.hide();
    this.currentSearchTerm.set(null);
    this.popupPosition.set(null);
    this.currentHighlight = null;
    this.isWordHovered.set(false);
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

  private getHitTextNodeAndOffset(event: MouseEvent): { node: Node, offset: number } | null {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'WEBVIEW' || target?.closest('app-yomitan-popup')) {
      return null;
    }

    // Direct hit test using browser API (handles z-index/stacking correctly)
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range) {
      return null;
    }

    let node = range.startContainer;
    const container = this.subtitleContainer()?.nativeElement;

    // Validate the node
    if (!container || !container.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    let offset = range.startOffset;
    const length = node.textContent?.length || 0;

    // Verify the cursor is actually overlapping the character bounding box
    const rangeCheck = document.createRange();
    let isVisuallyInside = false;

    // Check character to the RIGHT of the insertion point (if exists)
    if (offset < length) {
      rangeCheck.setStart(node, offset);
      rangeCheck.setEnd(node, offset + 1);
      if (this.isPointInRects(event, rangeCheck.getClientRects())) {
        isVisuallyInside = true;
      }
    }

    // Check character to the LEFT of the insertion point (if exists)
    if (!isVisuallyInside && offset > 0) {
      rangeCheck.setStart(node, offset - 1);
      rangeCheck.setEnd(node, offset);
      if (this.isPointInRects(event, rangeCheck.getClientRects())) {
        isVisuallyInside = true;
      }
    }

    if (!isVisuallyInside) {
      return null;
    }

    // Precision check: Right-half character detection
    if (offset > 0) {
      const prevCharRange = document.createRange();
      prevCharRange.setStart(node, offset - 1);
      prevCharRange.setEnd(node, offset);
      const prevRects = Array.from(prevCharRange.getClientRects());
      const isOverPrevChar = this.isPointInRects(event, prevRects);

      if (isOverPrevChar) {
        offset = offset - 1;
      }
    }

    if (!this.interactiveTextNodes.includes(node)) {
      const canonicalNode = this.interactiveTextNodes.find(n =>
        n.textContent === node.textContent &&
        // Heuristic: overlapping bounding boxes imply they represent the same text
        this.areNodesVisuallyOverlapping(n, node)
      );

      if (canonicalNode) {
        node = canonicalNode;
        offset = Math.min(offset, node.textContent?.length || 0);
      }
    }

    // Final bounds check
    if (offset < length) {
      return {node, offset};
    }

    return null;
  }

  private isPointInRects(event: MouseEvent, rects: DOMRectList | DOMRect[]): boolean {
    // Small tolerances to handle line-height quirks or diacritics sticking out
    const VERTICAL_TOLERANCE = 4;
    const HORIZONTAL_TOLERANCE = 1;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (
        event.clientX >= r.left - HORIZONTAL_TOLERANCE &&
        event.clientX <= r.right + HORIZONTAL_TOLERANCE &&
        event.clientY >= r.top - VERTICAL_TOLERANCE &&
        event.clientY <= r.bottom + VERTICAL_TOLERANCE
      ) {
        return true;
      }
    }
    return false;
  }

  private areNodesVisuallyOverlapping(nodeA: Node, nodeB: Node): boolean {
    const rangeA = document.createRange();
    rangeA.selectNode(nodeA);
    const rectA = rangeA.getBoundingClientRect();

    const rangeB = document.createRange();
    rangeB.selectNode(nodeB);
    const rectB = rangeB.getBoundingClientRect();

    // Check for significant overlap
    const intersectionX = Math.max(0, Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left));
    const intersectionY = Math.max(0, Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top));
    const intersectionArea = intersectionX * intersectionY;

    // If intersection covers > 50% of the smaller node's area, assume they are layers of the same text
    const areaA = rectA.width * rectA.height;
    const areaB = rectB.width * rectB.height;
    const minArea = Math.min(areaA, areaB);

    return intersectionArea > (minArea * 0.5);
  }

  private getWordInfoFromEvent(event: MouseEvent): { node: Node, start: number, end: number } | null {
    const hit = this.getHitTextNodeAndOffset(event);
    if (!hit) {
      return null;
    }

    const text = hit.node.textContent || '';
    const offset = hit.offset;

    const currentLang = this.projectSettingsStateService.subtitlesLanguage();
    const characterResolutionLangs = ['ja', 'zh', 'yue'];
    const isCharBasedLanguage = characterResolutionLangs.includes(currentLang);

    // Only force character selection if CTRL is held OR if user is currently dragging (selecting)
    const forceCharMode = event.ctrlKey || (this.isSelecting() && isCharBasedLanguage);

    if (forceCharMode) {
      // Ensure cursor is not outside bounds
      if (offset < text.length) {
        // Ensure cursor is not at whitespace
        if (/\s/.test(text[offset])) {
          return null;
        }

        // Handle surrogate pairs (e.g. rare Kanji, Emojis) to avoid splitting them
        const code = text.charCodeAt(offset);
        const isHighSurrogate = code >= 0xD800 && code <= 0xDBFF;
        const length = isHighSurrogate ? 2 : 1;

        if (offset + length <= text.length) {
          return {
            node: hit.node,
            start: offset,
            end: offset + length
          };
        }
      }
    }

    const boundaries = this.tokenizationService.getWordBoundaries(hit.node.textContent || '', hit.offset);
    if (boundaries) {
      return {node: hit.node, ...boundaries};
    }

    return null;
  }

  private handleMouseDown(event: MouseEvent): void {
    const isPopupOpen = !!this.currentSearchTerm();
    const isMenuOpen = this.isContextMenuOpen();

    this.shouldPreventVideoToggle = isPopupOpen || isMenuOpen;

    if (isMenuOpen) {
      this.closeContextMenu.emit();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Capture the current Yomitan highlight BEFORE clearing it.
    // This allows to use the specific dictionary segmentation (e.g. "じめ" instead of "はじめまして")
    // for the subsequent selection logic.
    this.lastYomitanHighlight = this.currentHighlight;

    this.clearHighlightAndPopup();

    if (this.projectSettingsStateService.useMpvSubtitles() || event.button !== 0) {
      return;
    }

    // Determine wordInfo with priority: Active Yomitan Highlight > Standard Tokenizer
    let wordInfo: { node: Node, start: number, end: number } | null = null;
    const hit = this.getHitTextNodeAndOffset(event);

    if (hit && this.lastYomitanHighlight &&
      this.lastYomitanHighlight.node === hit.node &&
      hit.offset >= this.lastYomitanHighlight.start &&
      hit.offset < this.lastYomitanHighlight.end) {
      // The click occurred within the bounds of the Yomitan suggestion. Use it.
      wordInfo = this.lastYomitanHighlight;
    } else {
      // Fallback: Use standard word boundary logic (or CTRL logic inside getWordInfoFromEvent)
      wordInfo = this.getWordInfoFromEvent(event);
    }

    const container = this.subtitleContainer().nativeElement;

    if (wordInfo && container.contains(wordInfo.node)) {
      this.shouldPreventVideoToggle = true;

      if (!this.videoStateService.isPaused()) {
        this.videoStateService.togglePlayPause();
      }

      event.preventDefault();
      event.stopPropagation();
      this.isSelecting.set(true);
      this.selectionAnchor = wordInfo;
      this.selectionFocus = wordInfo;
      this.updateSelectionHighlight();
    }
  }

  private handleGlobalMouseDown(event: MouseEvent, container: HTMLDivElement) {
    const target = event.target as Node;

    // If click is inside the video container, ignore it
    if (container.contains(target)) {
      return;
    }

    // If click is inside the popup itself, also ignore it
    if ((target as HTMLElement).closest('.yomitan-popup-wrapper')) {
      return;
    }

    // Otherwise (user clicked away), close the popup if open
    if (this.currentSearchTerm()) {
      this.clearHighlightAndPopup();
    }
  };

  private handleMouseMove(event: MouseEvent, isImmediate: boolean = false): void {
    this.lastMouseEvent = event;

    if (this.isSelecting()) {
      event.preventDefault();
      const wordInfo = this.getWordInfoFromEvent(event);
      if (wordInfo) {
        if (wordInfo.node !== this.selectionFocus?.node || wordInfo.start !== this.selectionFocus?.start) {
          this.selectionFocus = wordInfo;
          this.updateSelectionHighlight();
        }
      }
    } else {
      if (this.isContextMenuOpen() || this.projectSettingsStateService.useMpvSubtitles() || this.isHoverBlocked) {
        return;
      }

      const hitInfo = this.getHitTextNodeAndOffset(event);
      const isCtrl = event.ctrlKey;

      // OPTIMIZATION: Only proceed if cursor moved to a different character/node
      if (
        hitInfo?.node === this.lastLogicalHit?.node &&
        hitInfo?.offset === this.lastLogicalHit?.offset &&
        isCtrl === this.lastLogicalHit?.ctrlKey
      ) {
        return;
      }

      this.lastLogicalHit = hitInfo ? {...hitInfo, ctrlKey: isCtrl} : null;

      if (hitInfo) {
        this.hoverSubject.next({
          event,
          textNode: hitInfo.node,
          offset: hitInfo.offset,
          isImmediate
        });
      } else {
        // Emit null to allow debouncer to cancel pending "real" lookups if user moved to empty space
        this.hoverSubject.next(null);
      }
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (!this.isSelecting()) {
      return;
    }

    if (event.button !== 0) {
      this.isSelecting.set(false);
      this.selectionAnchor = null;
      this.selectionFocus = null;
      this.clearHighlightAndPopup();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const selectedText = this.getSelectedText().trim();
    const wasSimpleClick = (this.selectionAnchor?.node === this.selectionFocus?.node) &&
      (this.selectionAnchor?.start === this.selectionFocus?.start);

    this.isSelecting.set(false);
    this.selectionAnchor = null;
    this.selectionFocus = null;

    if (selectedText) {
      if (wasSimpleClick) {
        this.clearHighlightAndPopup();
        this.defaultActionRequested.emit(selectedText);
      } else {
        this.clearHighlightAndPopup();
        this.isHoverBlocked = true;
        this.contextMenuRequested.emit({event, text: selectedText});
      }
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    this.clearHighlightAndPopup();
    if (this.projectSettingsStateService.useMpvSubtitles()) {
      return;
    }

    let textForMenu = '';

    if (this.isSelecting()) {
      textForMenu = this.getSelectedText().trim();
    } else {
      // Prefer the last known Yomitan highlight
      let wordInfo: { node: Node, start: number, end: number } | null = null;
      const hit = this.getHitTextNodeAndOffset(event);

      if (hit && this.lastYomitanHighlight &&
        this.lastYomitanHighlight.node === hit.node &&
        hit.offset >= this.lastYomitanHighlight.start &&
        hit.offset < this.lastYomitanHighlight.end) {
        wordInfo = this.lastYomitanHighlight;
      } else {
        wordInfo = this.getWordInfoFromEvent(event);
      }

      if (wordInfo && wordInfo.node.textContent) {
        textForMenu = wordInfo.node.textContent.substring(wordInfo.start, wordInfo.end);
      }
    }

    if (!textForMenu?.trim()?.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!this.videoStateService.isPaused()) {
      this.videoStateService.togglePlayPause();
    }

    this.contextMenuRequested.emit({event, text: textForMenu});
  }

  private handleKeyChange(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.currentSearchTerm()) {
        event.preventDefault();
        event.stopPropagation();
        this.clearHighlightAndPopup();
        return;
      }
    }

    if (event.key === 'Control' && this.lastMouseEvent && !this.isSelecting()) {
      const syntheticEvent = new MouseEvent('mousemove', {
        clientX: this.lastMouseEvent.clientX,
        clientY: this.lastMouseEvent.clientY,
        ctrlKey: event.ctrlKey,
        bubbles: true,
        cancelable: true
      });

      this.handleMouseMove(syntheticEvent, true);
    }
  };

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

    // Join parts and normalize all whitespace (newlines, tabs, multiple spaces) to a single space
    return selectedParts.join(' ').replace(/\s+/g, ' ');
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
