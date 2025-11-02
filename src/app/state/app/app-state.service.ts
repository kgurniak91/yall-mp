import {computed, DestroyRef, inject, Injectable, Injector, signal} from '@angular/core';
import {AppData, CoreConfig, Project} from '../../model/project.types';
import {DEFAULT_GLOBAL_SETTINGS, DEFAULT_PROJECT_SETTINGS, GlobalSettings} from '../../model/settings.types';
import {AnkiSettings} from '../../model/anki.types';
import {StorageService} from '../../core/services/storage/storage.service';
import {merge} from 'lodash-es';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {debounceTime, skip} from 'rxjs';

const defaults: AppData = {
  projects: [],
  lastOpenedProjectId: null,
  globalSettings: DEFAULT_GLOBAL_SETTINGS,
  ankiSettings: {
    ankiCardTemplates: [],
    tags: ['yall-mp']
  }
};

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  private readonly storageService = inject(StorageService);
  private readonly _appData = signal<AppData>(defaults);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  private readonly coreConfig = computed<CoreConfig>(() => ({
    projectIds: this._appData().projects.map(p => p.id),
    lastOpenedProjectId: this._appData().lastOpenedProjectId,
    globalSettings: this._appData().globalSettings,
    ankiSettings: this._appData().ankiSettings,
  }));

  public readonly projects = computed(() => {
    return this._appData().projects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
  });

  public readonly lastOpenedProjectId = computed(() => this._appData()?.lastOpenedProjectId);

  public readonly lastOpenedProject = computed(() => {
    return this._appData().projects.find(p => p.id === this.lastOpenedProjectId()) ?? null;
  });

  public readonly globalSettings = computed(() => this._appData().globalSettings);
  public readonly ankiSettings = computed(() => this._appData().ankiSettings);

  constructor() {
    toObservable(this.coreConfig, {injector: this.injector}).pipe(
      skip(1), // Skip the initial value on app load to prevent an unnecessary write
      debounceTime(500),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(configToSave => {
      this.storageService.saveCoreConfig(configToSave);
    });
  }

  public async loadAppData(): Promise<void> {
    const data = await this.storageService.get();
    if (data) {
      const mergedData = merge({}, defaults, data);

      if (data.globalSettings?.subtitleLookupServices) {
        mergedData.globalSettings.subtitleLookupServices = data.globalSettings.subtitleLookupServices;
      }

      if (data.ankiSettings?.ankiCardTemplates) {
        mergedData.ankiSettings.ankiCardTemplates = data.ankiSettings.ankiCardTemplates;
      }

      if (mergedData.projects?.length) {
        mergedData.projects = mergedData.projects.map(p => {
          const completeSettings = merge({}, DEFAULT_PROJECT_SETTINGS, p.settings);
          return {...p, settings: completeSettings};
        });
      }

      this._appData.set(mergedData);
    }
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

      this.storageService.saveProject(project);

      return {
        ...data,
        projects: [...data.projects, project],
        lastOpenedProjectId: project.id
      };
    });
  }

  public updateProject(projectId: string, updates: Partial<Project>): void {
    this._appData.update(currentData => {
      const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
        console.error(`Project with ID ${projectId} not found. Cannot update.`);
        return currentData;
      }

      const projectToUpdate = currentData.projects[projectIndex];
      const updatedProject = {
        ...projectToUpdate,
        ...updates
      };

      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = updatedProject;

      this.storageService.saveProject(updatedProject);

      return {
        ...currentData,
        projects: projectsCopy
      };
    });
  }

  public setCurrentProject(projectId: string): void {
    this._appData.update(currentData => {
      const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
        return currentData;
      }

      const projectToUpdate = {
        ...currentData.projects[projectIndex],
        lastOpenedDate: Date.now()
      };
      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = projectToUpdate;

      this.storageService.saveProject(projectToUpdate);

      return {
        ...currentData,
        projects: projectsCopy,
        lastOpenedProjectId: projectId
      };
    });
  }

  public deleteProject(projectId: string): void {
    window.electronAPI.deleteProjectFonts(projectId);
    this.storageService.deleteProjectFile(projectId);

    this._appData.update(data => {
      const updatedProjects = data.projects.filter(p => p.id !== projectId);
      let newLastOpenedProjectId = data.lastOpenedProjectId;

      if (data.lastOpenedProjectId === projectId) {
        // Sort remaining projects to find the most recently opened one
        const sortedRemaining = updatedProjects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
        newLastOpenedProjectId = sortedRemaining.length > 0 ? sortedRemaining[0].id : null;
      }

      return {
        ...data,
        projects: updatedProjects,
        lastOpenedProjectId: newLastOpenedProjectId
      };
    });
  }

  public updateGlobalSettings(updates: Partial<GlobalSettings>): void {
    this._appData.update(currentData => ({
      ...currentData,
      globalSettings: {...currentData.globalSettings, ...updates}
    }));
  }

  public updateAnkiSettings(updates: Partial<AnkiSettings>): void {
    this._appData.update(currentData => ({
      ...currentData,
      ankiSettings: {...currentData.ankiSettings, ...updates}
    }));
  }

  public addAnkiExportToHistory(projectId: string, subtitleId: string): void {
    this._appData.update(currentData => {
      const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
        console.error(`Project with ID ${projectId} not found. Cannot update Anki history.`);
        return currentData;
      }

      const project = currentData.projects[projectIndex];
      const currentHistory = project.ankiExportHistory || [];

      // Avoid adding duplicates
      if (currentHistory.includes(subtitleId)) {
        return currentData;
      }

      const updatedProject = {
        ...project,
        ankiExportHistory: [...currentHistory, subtitleId]
      };

      const projectsCopy = [...currentData.projects];
      projectsCopy[projectIndex] = updatedProject;

      this.storageService.saveProject(updatedProject);

      return {
        ...currentData,
        projects: projectsCopy
      };
    });
  }

}
