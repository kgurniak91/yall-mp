import {Injectable} from '@angular/core';
import {AppData} from '../../../model/project.types';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  set(newData: AppData): void {
    window.electronAPI.setAppData(newData).catch(err => {
      console.error('Failed to save data through Electron API', err);
    });
  }

  get(): Promise<AppData | null> {
    return window.electronAPI.getAppData();
  }
}
