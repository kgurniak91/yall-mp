import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

@Injectable()
export class SubtitlesHighlighterService {
  private highlightRectsSubject = new BehaviorSubject<DOMRect[]>([]);
  public highlightRects$ = this.highlightRectsSubject.asObservable();

  public show(rects: DOMRect | DOMRect[]): void {
    const rectArray = Array.isArray(rects) ? rects : [rects];
    this.highlightRectsSubject.next(rectArray);
  }

  public hide(): void {
    this.highlightRectsSubject.next([]);
  }
}
