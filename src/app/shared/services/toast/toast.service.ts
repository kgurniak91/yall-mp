import {inject, Injectable, signal} from '@angular/core';
import {MessageService, ToastMessageOptions} from 'primeng/api';

export type ToastPosition =
  'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'bottom-center'
  | 'center';

const MAX_TOASTS = 5;

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly _position = signal<ToastPosition>('top-right');
  private readonly messageService = inject(MessageService);
  private activeToasts = new Set<ToastMessageOptions>();

  public readonly position = this._position.asReadonly();

  public setPosition(position: ToastPosition): void {
    this._position.set(position);
  }

  public onToastClosed(message: ToastMessageOptions) {
    this.activeToasts.delete(message);
  }

  success(message: string = 'Saved successfully'): void {
    this.add({
      severity: 'success',
      summary: 'Success',
      detail: message
    });
  }

  info(message: string): void {
    this.add({
      severity: 'info',
      summary: 'Information',
      detail: message
    });
  }

  warn(message: string): void {
    this.add({
      severity: 'warn',
      summary: 'Warning',
      detail: message,
      life: 5000
    });
  }

  error(message: string = 'Unknown error'): void {
    this.add({
      severity: 'error',
      summary: 'Error',
      detail: message,
      life: 5000
    });
  }

  dailyGoalProgress(templateName: string, current: number, target: number): void {
    const percent = Math.min(100, Math.round((current / target) * 100));
    this.add({
      severity: 'info',
      summary: 'Daily Goal Progress',
      detail: templateName,
      data: {type: 'daily-goal-progress', current, target, progressPercent: percent},
      life: 3000
    });
  }

  dailyGoalReached(templateName: string, target: number): void {
    this.add({
      severity: 'success',
      summary: 'Daily Goal Reached! 🎉',
      detail: templateName,
      data: {type: 'daily-goal-reached', current: target, target, progressPercent: 100},
      life: 6000
    });
  }

  private add(message: ToastMessageOptions): void {
    if (this.activeToasts.size >= MAX_TOASTS) {
      this.messageService.clear();
      this.activeToasts.clear();
    }

    this.messageService.add(message);
    this.activeToasts.add(message);
  }
}
