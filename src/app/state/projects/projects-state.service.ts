import {computed, inject, Injectable, signal} from '@angular/core';
import {AppData, Project} from '../../model/project.types';
import {LocalStorageService} from '../../core/services/local-storage/local-storage.service';

const APP_DATA_KEY = 'yall-mp-app-data';

const defaults: AppData = {
  projects: [],
  lastOpenedProjectId: null
};

@Injectable({
  providedIn: 'root'
})
export class ProjectsStateService {
  private readonly storageService = inject(LocalStorageService);
  private readonly _appData = signal<AppData>(defaults);

  public readonly projects = computed(() => {
    return this._appData().projects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
  });

  public readonly lastOpenedProjectId = computed(() => {
    return this._appData()?.lastOpenedProjectId ?? null;
  });

  public readonly lastOpenedProject = computed(() => {
    return this._appData().projects.find(p => p.id === this.lastOpenedProjectId()) ?? null;
  });

  constructor() {
    this.loadData();
  }

  public addProject(project: Project): void {
    this._appData.update(data => {
      const projectExists = data.projects.some(p => p.id === project.id);
      if (projectExists) {
        return data;
      }

      const updatedProjects = [...data.projects, project];

      const newData: AppData = {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: project.id // Make the new project the active one
      };

      this.storageService.setItem(APP_DATA_KEY, newData);
      return newData;
    });
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

  private loadData(): void {
    const data = this.storageService.getItem<AppData>(APP_DATA_KEY);
    if (data) {
      this._appData.set(data);
    }
  }
}
