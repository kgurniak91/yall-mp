import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

@Injectable()
export class SubtitlesHighlighterService {
  private highlightRectSubject = new BehaviorSubject<DOMRect | null>(null);
  public highlightRect$ = this.highlightRectSubject.asObservable();

  public show(rect: DOMRect): void {
    this.highlightRectSubject.next(rect);
  }

  public hide(): void {
    this.highlightRectSubject.next(null);
  }
}
