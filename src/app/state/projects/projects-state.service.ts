import {computed, inject, Injectable, signal} from '@angular/core';
import {AppData, Project} from '../../model/project.types';
import {LocalStorageService} from '../../core/services/local-storage/local-storage.service';
import {DEFAULT_GLOBAL_SETTINGS, GlobalSettings} from '../../model/settings.types';

const APP_DATA_KEY = 'yall-mp-app-data';

const defaults: AppData = {
  projects: [],
  lastOpenedProjectId: null,
  globalSettings: DEFAULT_GLOBAL_SETTINGS
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

  public readonly lastOpenedProjectId = computed(() => this._appData()?.lastOpenedProjectId);

  public readonly lastOpenedProject = computed(() => {
    return this._appData().projects.find(p => p.id === this.lastOpenedProjectId()) ?? null;
  });

  public readonly globalSettings = computed(() => this._appData().globalSettings);

  constructor() {
    this.loadAppDataFromStorage();
  }

  public getProjectById(projectId: string): Project | null {
    return this._appData().projects.find(p => p.id === projectId) || null;
  }

  public createProject(project: Project): void {
    this._appData.update(data => {
      const projectExists = data.projects.some(p => p.id === project.id);
      if (projectExists) {
        return data; // Project already exists, do nothing
      }

      const updatedProjects = [...data.projects, project];
      const newData: AppData = {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: project.id // Make the new project the active one
      };
      this.saveAppDataToStorage(newData);
      return newData;
    });
  }

  public updateProject(projectId: string, updates: Partial<Project>): void {
    this._appData.update(currentData => {
      const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
        console.error(`Project with ID ${projectId} not found. Cannot update.`);
        return currentData;
      }

      const updatedProject = {
        ...currentData.projects[projectIndex],
        ...updates
      };
      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = updatedProject;

      const newData: AppData = {
        ...currentData,
        projects: projectsCopy
      };
      this.saveAppDataToStorage(newData);
      return newData;
    });
  }

  public setCurrentProject(projectId: string): void {
    this._appData.update(currentData => {
      const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
        return currentData; // Project not found
      }

      const projectToUpdate = {
        ...currentData.projects[projectIndex],
        lastOpenedDate: Date.now()
      };
      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = projectToUpdate;

      const newData: AppData = {
        ...currentData,
        projects: projectsCopy,
        lastOpenedProjectId: projectId
      };
      this.saveAppDataToStorage(newData);
      return newData;
    });
  }

  public deleteProject(projectId: string): void {
    this._appData.update(data => {
      const updatedProjects = data.projects.filter(p => p.id !== projectId);
      let newLastOpenedProjectId = data.lastOpenedProjectId;

      if (data.lastOpenedProjectId === projectId) {
        // Sort remaining projects to find the most recently opened one
        const sortedRemaining = updatedProjects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
        newLastOpenedProjectId = sortedRemaining.length > 0 ? sortedRemaining[0].id : null;
      }

      const newData: AppData = {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: newLastOpenedProjectId
      };
      this.saveAppDataToStorage(newData);
      return newData;
    });
  }

  public updateGlobalSettings(updates: Partial<GlobalSettings>): void {
    this._appData.update(currentData => {
      const newGlobalSettings = {...currentData.globalSettings, ...updates};
      const newData = {...currentData, globalSettings: newGlobalSettings};
      this.saveAppDataToStorage(newData);
      return newData;
    });
  }

  private saveAppDataToStorage(newData: AppData) {
    this.storageService.setItem(APP_DATA_KEY, newData);
  }

  private loadAppDataFromStorage(): void {
    const data = this.storageService.getItem<AppData>(APP_DATA_KEY);
    if (data) {
      this._appData.set(data);
    }
  }
}
