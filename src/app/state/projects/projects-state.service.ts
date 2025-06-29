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

  public getProjectById(projectId: string): Project | null {
    return this._appData().projects.find(p => p.id === projectId) || null;
  }

  public createProject(project: Project): void {
    this._appData.update(data => {
      const projectExists = data.projects.some(p => p.id === project.id);
      if (projectExists) {
        return data;
      }

      const updatedProjects = [...data.projects, project];

      // TODO parse subtiles etc.

      const newData: AppData = {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: project.id // Make the new project the active one
      };

      this.storageService.setItem(APP_DATA_KEY, newData);
      return newData;
    });
  }

  public updateProject(projectId: string, updates: Partial<Project>): void {
    const data = this._appData();
    const projectIndex = data.projects.findIndex(p => p.id === projectId);

    if (projectIndex === -1) {
      console.error(`Project with ID ${projectId} not found. Cannot update.`);
      return;
    }

    const originalProject = data.projects[projectIndex];
    const updatedProject = { ...originalProject, ...updates };

    // TODO parse subtiles etc.

    this._appData.update(currentData => {
      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = updatedProject;

      const newData: AppData = {
        ...currentData,
        projects: projectsCopy
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

  public deleteProject(projectId: string): void {
    this._appData.update(data => {
      const updatedProjects = this.projects().filter(p => p.id !== projectId);

      let newLastOpenedProjectId: string | null;
      if (data.lastOpenedProjectId === projectId) {
        if (updatedProjects.length) {
          newLastOpenedProjectId = updatedProjects[0].id; // last opened on top
        } else {
          newLastOpenedProjectId = null;
        }
      } else {
        newLastOpenedProjectId = data.lastOpenedProjectId; // no change
      }

      const newData: AppData = {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: newLastOpenedProjectId
      };

      this.storageService.setItem(APP_DATA_KEY, newData);

      return newData;
    });
  }

  private loadData(): void {
    const data = this.storageService.getItem<AppData>(APP_DATA_KEY);
    if (data) {
      this._appData.set(data);
    }
  }
}
