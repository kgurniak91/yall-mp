import {inject, Injectable, signal} from '@angular/core';
import {MessageService} from 'primeng/api';

export type ToastPosition =
  'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'bottom-center'
  | 'center';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly _position = signal<ToastPosition>('top-right');
  private readonly messageService = inject(MessageService);

  public readonly position = this._position.asReadonly();

  public setPosition(position: ToastPosition): void {
    this._position.set(position);
  }

  success(message: string = 'Saved successfully'): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: message
    });
  }

  info(message: string): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Information',
      detail: message
    });
  }

  warn(message: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Warning',
      detail: message,
      life: 5000
    });
  }

  error(message: string = 'Unknown error'): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: message,
      life: 5000
    });
  }
}
