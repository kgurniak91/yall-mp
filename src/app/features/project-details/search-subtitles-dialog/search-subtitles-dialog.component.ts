import {AfterViewInit, ChangeDetectionStrategy, Component, inject, OnInit, signal, viewChild} from '@angular/core';
import {VideoClip} from '../../../model/video.types';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormsModule} from '@angular/forms';
import {InputText} from 'primeng/inputtext';
import {DatePipe} from '@angular/common';
import {Divider} from 'primeng/divider';
import {Button} from 'primeng/button';
import {ScrollPanel} from 'primeng/scrollpanel';
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

@Component({
  selector: 'app-search-subtitles-dialog',
  imports: [
    FormsModule,
    InputText,
    DatePipe,
    Divider,
    Button,
    ScrollPanel,
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
  protected readonly scrollPanel = viewChild<ScrollPanel>('scrollPanel');
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private allSearchableClips: SearchResult[] = [];
  private initialScrollTargetId: string | null = null;

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

    const currentItem = this.allSearchableClips.find(i => i.isCurrent);

    if (currentItem) {
      this.initialScrollTargetId = currentItem.clip.id;
    } else {
      // Fallback: scroll to first item if somehow nothing is current (e.g., before 0s or after end)
      this.initialScrollTargetId = this.allSearchableClips[0].clip.id;
    }

    this.filteredClips.set(this.allSearchableClips);
  }

  ngAfterViewInit() {
    if (this.initialScrollTargetId) {
      setTimeout(() => {
        this.scrollToClip(this.initialScrollTargetId!);
      }, 100);
    }
  }

  onSearchQueryChange(query: string) {
    this.filterClips(query);
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

  private filterClips(query: string) {
    if (!query || query.trim().length === 0) {
      this.filteredClips.set(this.allSearchableClips);
      this.refreshScrollPanel();
      return;
    }

    const normalizedQuery = query.toLowerCase().trim();

    const matches = this.allSearchableClips.filter(item => {
      if (item.isGap) {
        return false;
      }
      return item.cleanText.toLowerCase().includes(normalizedQuery);
    });

    this.filteredClips.set(matches);
    this.refreshScrollPanel();
  }

  private refreshScrollPanel() {
    setTimeout(() => {
      this.scrollPanel()?.refresh();
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
