import {computed, DestroyRef, inject, Injectable, Injector, signal} from '@angular/core';
import {AppData, CoreConfig, MinimalProject, Project} from '../../model/project.types';
import {DEFAULT_GLOBAL_SETTINGS, DEFAULT_PROJECT_SETTINGS, GlobalSettings} from '../../model/settings.types';
import {AnkiSettings} from '../../model/anki.types';
import {StorageService} from '../../core/services/storage/storage.service';
import {merge} from 'lodash-es';
import {debounceTime, skip} from 'rxjs';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {normalizeLanguageCode} from '../../../../shared/types/yomitan';

const defaults: AppData = {
  projects: [],
  currentProject: null,
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
    projects: this._appData().projects,
    lastOpenedProjectId: this._appData().currentProject?.id ?? null,
    globalSettings: this._appData().globalSettings,
    ankiSettings: this._appData().ankiSettings,
  }));

  public readonly projects = computed(() => {
    return this._appData().projects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
  });

  public readonly currentProjectId = computed(() => this._appData().currentProject?.id ?? null);
  public readonly currentProject = computed(() => this._appData().currentProject);

  public readonly globalSettings = computed(() => this._appData().globalSettings);
  public readonly ankiSettings = computed(() => this._appData().ankiSettings);

  constructor() {
    toObservable(this.coreConfig, {injector: this.injector}).pipe(
      skip(1), // Skip the initial value on app load to prevent an unnecessary write
      debounceTime(500),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((configToSave: CoreConfig) => {
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

      if (mergedData.currentProject) {
        this.migrateLanguageCodeForProject(mergedData.currentProject);
        mergedData.currentProject.settings = merge({}, DEFAULT_PROJECT_SETTINGS, mergedData.currentProject.settings);
      }

      this._appData.set(mergedData);
    }
  }

  public async getProjectById(projectId: string): Promise<Project | null> {
    if (this.currentProjectId() === projectId) {
      return this.currentProject();
    }
    return this.storageService.getProjectById(projectId);
  }

  public createProject(project: Project): void {
    const minimalProject: MinimalProject = this.toMinimalProject(project);

    this._appData.update(data => {
      const projectExists = data.projects.some(p => p.id === project.id);
      if (projectExists) {
        return data;
      }

      this.storageService.saveProject(project);

      return {
        ...data,
        projects: [...data.projects, minimalProject],
        currentProject: project
      };
    });
  }

  public updateProject(projectId: string, updates: Partial<Project>): void {
    if (updates.subtitles) {
      updates.lastSubtitleEndTime = updates.subtitles.length > 0
        ? Math.max(...updates.subtitles.map(s => s.endTime))
        : 0;
    }

    this._appData.update(currentData => {
      const isUpdatingCurrentProject = currentData.currentProject?.id === projectId;
      if (!isUpdatingCurrentProject) {
        console.error(`Attempted to update a project that is not currently loaded. ID: ${projectId}`);
        return currentData;
      }

      const updatedProject = {
        ...currentData.currentProject!,
        ...updates
      };

      this.storageService.saveProject(updatedProject);

      const minimalProject = this.toMinimalProject(updatedProject);
      const projectsCopy = currentData.projects.map(p => p.id === projectId ? minimalProject : p);

      return {
        ...currentData,
        projects: projectsCopy,
        currentProject: updatedProject
      };
    });
  }

  public async setCurrentProject(projectId: string): Promise<void> {
    if (this.currentProjectId() === projectId) {
      return;
    }

    const projectToLoad = await this.storageService.getProjectById(projectId);
    if (!projectToLoad) {
      console.error(`Failed to set current project: Project with ID ${projectId} not found on disk.`);
      return;
    }

    this.migrateLanguageCodeForProject(projectToLoad);

    projectToLoad.lastOpenedDate = Date.now();
    const minimalProject = this.toMinimalProject(projectToLoad);

    this.storageService.saveProject(projectToLoad);

    this._appData.update(currentData => ({
      ...currentData,
      projects: currentData.projects.map(p => p.id === projectId ? minimalProject : p),
      currentProject: projectToLoad
    }));
  }

  public deleteProject(projectId: string): void {
    window.electronAPI.deleteProjectFonts(projectId);
    this.storageService.deleteProjectFile(projectId);

    this._appData.update(data => {
      const updatedProjects = data.projects.filter(p => p.id !== projectId);
      let newCurrentProject = data.currentProject;

      if (data.currentProject?.id === projectId) {
        newCurrentProject = null;
      }

      return {
        ...data,
        projects: updatedProjects,
        currentProject: newCurrentProject
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
      if (currentData.currentProject?.id !== projectId) {
        console.error(`Project with ID ${projectId} not found. Cannot update Anki history.`);
        return currentData;
      }

      const project = currentData.currentProject;
      const currentHistory = project.ankiExportHistory || [];

      if (currentHistory.includes(subtitleId)) {
        return currentData;
      }

      const updatedProject = {
        ...project,
        ankiExportHistory: [...currentHistory, subtitleId]
      };

      this.storageService.saveProject(updatedProject);

      return {
        ...currentData,
        currentProject: updatedProject
      };
    });
  }

  private toMinimalProject(project: Project): MinimalProject {
    return {
      id: project.id,
      mediaFileName: project.mediaFileName,
      subtitleFileName: project.subtitleFileName,
      mediaPath: project.mediaPath,
      createdDate: project.createdDate,
      lastOpenedDate: project.lastOpenedDate,
      duration: project.duration,
      lastPlaybackTime: project.lastPlaybackTime,
      subtitleCount: project.subtitles.length,
      lastSubtitleEndTime: project.lastSubtitleEndTime
    };
  }

  // Language migration from franc-all to Yomitan:
  private migrateLanguageCodeForProject(project: Project) {
    const detectedLanguage = normalizeLanguageCode(project.detectedLanguage);
    const selectedLanguage = normalizeLanguageCode(project.settings.subtitlesLanguage);

    if ((project.detectedLanguage !== detectedLanguage) || (project.settings.subtitlesLanguage !== selectedLanguage)) {
      console.log(`[Migration] Updating project language from ${project.detectedLanguage}/${project.settings.subtitlesLanguage} to ${detectedLanguage}/${selectedLanguage}`);
      project.detectedLanguage = detectedLanguage;
      project.settings.subtitlesLanguage = selectedLanguage;
    }
  }
}
