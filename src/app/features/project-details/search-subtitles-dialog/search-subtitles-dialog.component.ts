import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
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
import {Divider} from 'primeng/divider';
import {Button} from 'primeng/button';
import {Tag} from 'primeng/tag';
import {IconField} from 'primeng/iconfield';
import {InputIcon} from 'primeng/inputicon';
import {SearchSubtitlesDialogData} from './search-subtitles-dialog.types';

interface SearchResult {
  clip: VideoClip;
  cleanText: string;
  isCurrent: boolean;
  isGap: boolean;
}

const CONTEXT_RANGE = 10;
const MAX_SEARCH_RESULTS = 20;

@Component({
  selector: 'app-search-subtitles-dialog',
  imports: [
    FormsModule,
    InputText,
    DatePipe,
    Divider,
    Button,
    Tag,
    IconField,
    InputIcon
  ],
  templateUrl: './search-subtitles-dialog.component.html',
  styleUrl: './search-subtitles-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchSubtitlesDialogComponent implements OnInit, AfterViewInit {
  protected readonly searchQuery = signal('');
  protected readonly filteredClips = signal<SearchResult[]>([]);
  protected readonly resultsSummary = signal<string>('');
  protected readonly hasMoreAbove = signal(false);
  protected readonly hasMoreBelow = signal(false);
  protected readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
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

    if (!query || query.trim().length === 0) {
      let start = 0;
      let end: number;

      if (this.currentClipIndex !== -1) {
        start = Math.max(0, this.currentClipIndex - CONTEXT_RANGE);
        end = Math.min(totalItems, this.currentClipIndex + CONTEXT_RANGE + 1);
      } else {
        // Fallback: if no current index, show first page
        end = Math.min(totalItems, MAX_SEARCH_RESULTS);
      }

      const slice = this.allSearchableClips.slice(start, end);
      this.filteredClips.set(slice);

      this.hasMoreAbove.set(start > 0);
      this.hasMoreBelow.set(end < totalItems);
      this.resultsSummary.set('Showing nearest neighbours of the current clip');
    } else {
      const normalizedQuery = query.toLowerCase().trim();

      const matches = this.allSearchableClips.filter(item => {
        if (item.isGap) {
          return false;
        }
        return item.cleanText.toLowerCase().includes(normalizedQuery);
      });

      const totalMatches = matches.length;
      const slicedMatches = matches.slice(0, MAX_SEARCH_RESULTS);

      this.filteredClips.set(slicedMatches);
      this.hasMoreAbove.set(false); // Never show top dots in search results
      this.hasMoreBelow.set(totalMatches > MAX_SEARCH_RESULTS);

      if (totalMatches === 0) {
        this.resultsSummary.set('No matches found');
      } else if (totalMatches > MAX_SEARCH_RESULTS) {
        this.resultsSummary.set(`Showing top ${MAX_SEARCH_RESULTS} of ${totalMatches} matches`);
      } else {
        this.resultsSummary.set(`Found ${totalMatches} matches`);
      }
    }

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
    if (element) {
      element.scrollIntoView({block: 'center', behavior: 'smooth'});
    }
  }
}
