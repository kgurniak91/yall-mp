import {Component, computed, effect, ElementRef, inject, input, OnDestroy, viewChild} from '@angular/core';
import {VideoStateService} from '../../../state/video/video-state.service';
import {VideoClip} from '../../../model/video.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {HiddenSubtitleStyle} from '../../../model/settings.types';
import ASS from 'assjs';
import {SubtitlesHighlighterService} from '../services/subtitles-highlighter/subtitles-highlighter.service';
import {distinctUntilChanged, fromEvent, map, merge, throttleTime} from 'rxjs';

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

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

  protected readonly wrappedSrtText = computed(() => {
    const text = this.currentClip()?.text;
    if (!text) {
      return '';
    }
    return this.wrapWordsInSpans(text);
  });

  private readonly subtitleContainer = viewChild.required<ElementRef<HTMLDivElement>>('subtitleContainer');
  private readonly videoStateService = inject(VideoStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly subtitlesHighlighterService = inject(SubtitlesHighlighterService);
  private assInstance: ASS | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fakeVideo: any = null;
  private mutationObserver: MutationObserver | null = null;
  private isProcessing = false;

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
      if (container) {
        const handleInteraction = (event: MouseEvent) => this.handleSubtitleInteraction(event);
        container.addEventListener('mouseup', handleInteraction);
        onCleanup(() => {
          container.removeEventListener('mouseup', handleInteraction);
        });
      }
    });

    effect(() => {
      if (!this.rawAssContent() || !this.assInstance) {
        return;
      }

      if (this.shouldBeHidden()) {
        this.assInstance.hide();
      } else {
        this.assInstance.show();
      }
    });

    effect((onCleanup) => {
      const container = this.subtitleContainer()?.nativeElement;
      if (!container) {
        return;
      }

      const mouseMove$ = fromEvent<MouseEvent>(container, 'mousemove').pipe(
        throttleTime(50, undefined, {leading: true, trailing: true}),
        map(event => (event.target as HTMLElement)?.closest('.word')),
        distinctUntilChanged()
      );

      const mouseLeave$ = fromEvent(container, 'mouseleave').pipe(
        map(() => null)
      );

      // Merged single stream that determines which element to highlight:
      const subscription = merge(mouseMove$, mouseLeave$)
        .subscribe(wordSpan => {
          if (wordSpan) {
            this.subtitlesHighlighterService.show(wordSpan.getBoundingClientRect());
          } else {
            this.subtitlesHighlighterService.hide();
          }
        });

      onCleanup(() => {
        subscription.unsubscribe();
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyAssRenderer();
  }

  protected onDoubleClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  private processNodeRecursively(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('word')) {
      return; // don't re-process already wrapped subtitles
    }

    const children = Array.from(node.childNodes);

    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        const textNode = child as Text;
        const textContent = textNode.textContent;

        if (textContent && textContent.trim().length > 0) {
          const wrappedHtml = this.wrapWordsInSpans(textContent);
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = wrappedHtml;
          node.replaceChild(tempDiv, textNode);
          tempDiv.replaceWith(...tempDiv.childNodes);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        this.processNodeRecursively(child);
      }
    }
  }

  private wrapWordsInSpans(text: string): string {
    if (!text) return '';

    const regex = /([\p{L}\p{N}'-]+)|([^\p{L}\p{N}'-]+)/gu;
    let result = '';

    for (const match of text.matchAll(regex)) {
      const word = match[1];
      const punctuationOrSpace = match[2];

      if (word) {
        result += `<span class="word">${escapeHtml(word)}</span>`;
      } else if (punctuationOrSpace) {
        result += escapeHtml(punctuationOrSpace);
      }
    }

    return result;
  }

  private initializeOrUpdateAssRenderer(width: number, height: number): void {
    const assContent = this.rawAssContent();
    const renderContainer = this.subtitleContainer()?.nativeElement;

    if (!assContent || !renderContainer) {
      return;
    }

    this.destroyAssRenderer();

    this.fakeVideo = this.videoContainerElement();
    this.fakeVideo.videoWidth = width;
    this.fakeVideo.videoHeight = height;
    this.fakeVideo.currentTime = this.videoStateService.currentTime();
    this.fakeVideo.paused = false;
    const originalAddEventListener = this.fakeVideo.addEventListener.bind(this.fakeVideo);
    this.fakeVideo.addEventListener = (event: string, handler: any) => {
      if (['playing', 'pause', 'seeking'].includes(event)) {
        originalAddEventListener(event, handler);
      }
    };
    this.fakeVideo.removeEventListener = () => {
    };

    const containerAspectRatio = width / height;
    const videoAspectRatio = 16 / 9; // A common default for video content
    const resamplingMode = containerAspectRatio > videoAspectRatio
      ? 'script_height' // The container is wider: scale by height and center.
      : 'script_width';  // The container is taller: scale by width and center.

    this.assInstance = new ASS(assContent, this.fakeVideo, {
      container: renderContainer,
      resampling: resamplingMode
    });

    const assBox = renderContainer.querySelector<HTMLDivElement>('.ASS-box');
    if (assBox) {
      const observerCallback = () => {
        if (this.isProcessing) {
          return;
        }
        this.isProcessing = true;

        this.mutationObserver?.disconnect();

        this.processNodeRecursively(assBox);

        this.mutationObserver?.observe(assBox, {
          childList: true,
          subtree: true,
        });

        this.isProcessing = false;
      };

      this.mutationObserver = new MutationObserver(observerCallback);
      this.mutationObserver.observe(assBox, {
        childList: true,
        subtree: true,
      });
    }

    this.processNodeRecursively(renderContainer);

    setTimeout(() => {
      if (this.fakeVideo) {
        this.fakeVideo.dispatchEvent(new Event('playing'));
      }
    }, 0);
  }

  private destroyAssRenderer(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.assInstance?.destroy();
    this.assInstance = null;
    this.fakeVideo = null;
  }

  private handleSubtitleInteraction(event: MouseEvent): void {
    const selection = window.getSelection();

    // Case 1: The user has selected a phrase.
    if (selection && selection.toString().trim().length > 0) {
      const container = this.subtitleContainer().nativeElement;
      if (selection.anchorNode && container.contains(selection.anchorNode)) {
        console.log(`User selected phrase: "${selection.toString().trim()}"`);
        // TODO handle dictionary lookup
      }
      return;
    }

    // Case 2: The user performed a simple click (no selection).
    const target = event.target as HTMLElement;
    const wordSpan = target.closest('.word');
    if (wordSpan) {
      event.stopPropagation();
      const clickedWord = wordSpan.textContent?.trim();
      if (clickedWord) {
        console.log(`User clicked word: "${clickedWord}"`);
        // TODO handle dictionary lookup
      }
    }
  }
}
