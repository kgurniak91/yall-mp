import {computed, inject, Injectable, signal} from '@angular/core';
import {AppData, Project} from '../../model/project.types';
import {LocalStorageService} from '../../core/services/local-storage/local-storage.service';

const APP_DATA_KEY = 'yall-mp-app-data';

const defaults: AppData = {
  projects: [
    {
      id: 1,
      name: '',
      fileName: '',
      videoUrl: '',
      subtitleUrl: '',
      lastOpenedDate: 0,
      lastModifiedDate: 0,
      createdDate: 0
    }
  ],
  lastOpenedProjectId: 1
};

@Injectable({
  providedIn: 'root'
})
export class ProjectsStateService {
  private readonly storageService = inject(LocalStorageService);
  private readonly _appData = signal<AppData>(defaults);

  public readonly projects = computed(() => this._appData().projects);
  public readonly lastOpenedProject = computed(() => {
    const data = this._appData();
    if (!data.lastOpenedProjectId) {
      return null;
    }
    return data.projects.find(p => p.id === data.lastOpenedProjectId) ?? null;
  });

  constructor() {
    this.loadData();
  }

  private loadData(): void {
    const data = this.storageService.getItem<AppData>(APP_DATA_KEY);
    if (data) {
      this._appData.set(data);
    }
  }

  public setCurrentProject(project: Project): void {
    // 1. Get blob URLs from file handles
    // 2. Update Video.js source
    // 3. Parse subtitles and call clipsStateService.setCues()
    // 4. Reset other states

    this._appData.update(data => ({
      ...data,
      lastOpenProjectId: project.id
    }));

    this.storageService.setItem(APP_DATA_KEY, this._appData());
  }
}
