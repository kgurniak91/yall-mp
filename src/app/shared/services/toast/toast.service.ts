import {inject, Injectable} from '@angular/core';
import {MessageService} from 'primeng/api';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly messageService = inject(MessageService);

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
      detail: message
    });
  }

  error(message: string = 'Unknown error'): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: message
    });
  }
}
