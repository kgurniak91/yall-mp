import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild
} from '@angular/core';
import {VideoClip} from '../../../model/video.types';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormsModule} from '@angular/forms';
import {InputText} from 'primeng/inputtext';
import {DatePipe} from '@angular/common';
import {Button} from 'primeng/button';
import {Tag} from 'primeng/tag';
import {IconField} from 'primeng/iconfield';
import {InputIcon} from 'primeng/inputicon';
import {SearchSubtitlesDialogData} from './search-subtitles-dialog.types';
import {Tooltip} from 'primeng/tooltip';

interface SearchResult {
  clip: VideoClip;
  cleanText: string;
  isCurrent: boolean;
  isGap: boolean;
}

const CONTEXT_RANGE = 10;
const MAX_SEARCH_RESULTS = 20;
const LOAD_MORE_STEP = 10;

@Component({
  selector: 'app-search-subtitles-dialog',
  imports: [
    FormsModule,
    InputText,
    DatePipe,
    Button,
    Tag,
    IconField,
    InputIcon,
    Tooltip
  ],
  templateUrl: './search-subtitles-dialog.component.html',
  styleUrl: './search-subtitles-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchSubtitlesDialogComponent implements OnInit, AfterViewInit {
  protected readonly searchQuery = signal('');
  protected readonly resultsSummary = signal<string>('');

  protected readonly filteredClips = computed(() => {
    const matches = this.currentMatches();
    const start = this.visibleStartIndex();
    const end = this.visibleEndIndex();
    return matches.slice(start, end);
  });

  protected readonly hasMoreAbove = computed(() => this.visibleStartIndex() > 0);

  protected readonly hasMoreBelow = computed(() => {
    return this.visibleEndIndex() < this.currentMatches().length;
  });

  protected readonly loadMoreAboveTooltip = computed(() => {
    const totalHiddenAbove = this.visibleStartIndex();
    const toLoad = Math.min(LOAD_MORE_STEP, totalHiddenAbove);
    return `Click to show ${toLoad} out of ${totalHiddenAbove} additional results`;
  });

  protected readonly loadMoreBelowTooltip = computed(() => {
    const totalMatches = this.currentMatches().length;
    const currentEnd = this.visibleEndIndex();
    const totalHiddenBelow = totalMatches - currentEnd;
    const toLoad = Math.min(LOAD_MORE_STEP, totalHiddenBelow);
    return `Click to show ${toLoad} out of ${totalHiddenBelow} additional results`;
  });

  protected readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
  private readonly currentMatches = signal<SearchResult[]>([]);
  private readonly visibleStartIndex = signal(0);
  private readonly visibleEndIndex = signal(0);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private allSearchableClips: SearchResult[] = [];
  private initialScrollTargetId: string | null = null;
  private currentClipIndex = -1;

  ngOnInit() {
    const data = this.config.data as SearchSubtitlesDialogData;
    const clips: VideoClip[] = data?.clips || [];
    const currentTime = data?.currentTime || 0;

    const isInsideClip = (clip: VideoClip) => (currentTime >= clip.startTime) && (currentTime < clip.endTime);

    this.allSearchableClips = clips
      .filter(c => c.hasSubtitle || isInsideClip(c))
      .map(clip => {
        const isGap = !clip.hasSubtitle;
        return {
          clip,
          cleanText: isGap ? 'Current gap' : this.getCleanText(clip),
          isCurrent: isInsideClip(clip),
          isGap
        };
      });

    this.currentClipIndex = this.allSearchableClips.findIndex(i => i.isCurrent);

    // If no specific clip is active (e.g., before 0s or after end), default to first clip
    if (this.currentClipIndex === -1 && this.allSearchableClips.length > 0) {
      this.currentClipIndex = 0;
    }

    if (this.currentClipIndex !== -1) {
      this.initialScrollTargetId = this.allSearchableClips[this.currentClipIndex].clip.id;
    }

    this.performFiltering('');
  }

  ngAfterViewInit() {
    if (this.initialScrollTargetId && !this.searchQuery()) {
      setTimeout(() => {
        this.scrollToClip(this.initialScrollTargetId!);
      }, 100);
    }
  }

  onSearchQueryChange(query: string) {
    this.performFiltering(query);
  }

  loadMoreAbove() {
    const previousHeight = this.scrollContainer()?.nativeElement.scrollHeight || 0;

    // Determine new start index
    const currentStart = this.visibleStartIndex();
    const newStart = Math.max(0, currentStart - LOAD_MORE_STEP);

    this.visibleStartIndex.set(newStart);

    // Maintain visual scroll position relative to content
    setTimeout(() => {
      const container = this.scrollContainer()?.nativeElement;
      if (container) {
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - previousHeight;
        container.scrollTop += heightDiff;
      }
    });
  }

  loadMoreBelow() {
    const total = this.currentMatches().length;
    const currentEnd = this.visibleEndIndex();
    const newEnd = Math.min(total, currentEnd + LOAD_MORE_STEP);
    this.visibleEndIndex.set(newEnd);
  }

  selectClip(clip: VideoClip) {
    this.ref.close(clip);
  }

  close() {
    this.ref.close();
  }

  highlightMatch(item: SearchResult): string {
    const text = item.cleanText;
    const query = this.searchQuery().trim();

    // Don't highlight the placeholder text for current gap
    if (item.isGap || !query) {
      return text;
    }

    const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
    return text.replace(regex, '<span class="highlight-text">$1</span>');
  }

  private performFiltering(query: string) {
    const totalItems = this.allSearchableClips.length;
    let matches: SearchResult[];

    // Identify matches
    if (!query || query.trim().length === 0) {
      matches = this.allSearchableClips;
      this.resultsSummary.set('Showing nearest neighbours of the current clip');

      // Calculate default range centered on current clip
      if (this.currentClipIndex !== -1) {
        this.visibleStartIndex.set(Math.max(0, this.currentClipIndex - CONTEXT_RANGE));
        this.visibleEndIndex.set(Math.min(totalItems, this.currentClipIndex + CONTEXT_RANGE + 1));
      } else {
        this.visibleStartIndex.set(0);
        this.visibleEndIndex.set(Math.min(totalItems, MAX_SEARCH_RESULTS));
      }
    } else {
      const normalizedQuery = query.toLowerCase().trim();
      matches = this.allSearchableClips.filter(item => {
        if (item.isGap) {
          return false;
        }
        return item.cleanText.toLowerCase().includes(normalizedQuery);
      });

      const totalMatches = matches.length;

      // Default range starts from top
      this.visibleStartIndex.set(0);
      this.visibleEndIndex.set(Math.min(totalMatches, MAX_SEARCH_RESULTS));

      if (totalMatches === 0) {
        this.resultsSummary.set('No matches found');
      } else {
        this.resultsSummary.set(`Found ${totalMatches} matches`);
      }
    }

    this.currentMatches.set(matches);
    this.resetScroll();
  }

  private resetScroll() {
    setTimeout(() => {
      // In search mode, reset scroll to top so user sees the best matches first
      if (this.searchQuery()) {
        const el = this.scrollContainer()?.nativeElement;
        if (el) {
          el.scrollTop = 0;
        }
      }
    });
  }

  private getCleanText(clip: VideoClip): string {
    if (clip.parts && clip.parts.length > 0) {
      return clip.parts.map(p => p.text).join(' ');
    }

    if (clip.text) {
      return this.stripHtml(clip.text);
    }

    return '';
  }

  private stripHtml(html: string): string {
    const tmp = document.createElement('DIV');
    // Replace <br> with space to prevent word merging (e.g., "Line1<br>Line2" -> "Line1 Line2")
    tmp.innerHTML = html.replace(/<br\s*\/?>/gi, ' ');
    return tmp.textContent || tmp.innerText || '';
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private scrollToClip(clipId: string) {
    const element = document.getElementById(`search-clip-${clipId}`);
    const container = this.scrollContainer()?.nativeElement;

    if (element && container) {
      // Calculate positions relative to the viewport
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      // Calculate the exact target scroll position within the container
      const scrollOffset = elementRect.top - containerRect.top + container.scrollTop;
      const centerPosition = scrollOffset - (containerRect.height / 2) + (elementRect.height / 2);

      // Scroll ONLY the inner list of results
      container.scrollTo({top: centerPosition, behavior: 'smooth'});
    }
  }
}
