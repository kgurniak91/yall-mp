import {Injectable, Signal, signal, WritableSignal} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class VideoStateService {
  private readonly _currentTime: WritableSignal<number> = signal(0);
  public readonly currentTime: Signal<number> = this._currentTime.asReadonly();

  public updateCurrentTime(time: number): void {
    this._currentTime.set(time);
  }
}
