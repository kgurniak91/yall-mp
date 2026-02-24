import {computed, DestroyRef, inject, Injectable, Injector, signal} from '@angular/core';
import {AppData, Catalog, CoreConfig, DuplicateCatalogError, MinimalProject, Project} from '../../model/project.types';
import {
  DEFAULT_AI_SUBTITLE_LOOKUP_SERVICES,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  GlobalSettings
} from '../../model/settings.types';
import {AnkiSettings} from '../../model/anki.types';
import {StorageService} from '../../core/services/storage/storage.service';
import {merge} from 'lodash-es';
import {debounceTime, skip} from 'rxjs';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';
import {normalizeLanguageCode} from '../../../../shared/types/yomitan';
import {ROOT_CATALOG_ID} from '../../shared/types/catalog.types';

const defaults: AppData = {
  projects: [],
  currentProject: null,
  globalSettings: DEFAULT_GLOBAL_SETTINGS,
  ankiSettings: {
    ankiCardTemplates: [],
    tags: ['yall-mp'],
    progressTracker: {}
  },
  catalogs: []
};

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  private readonly storageService = inject(StorageService);
  private readonly _appData = signal<AppData>(defaults);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _activeCatalogId = signal<string>(ROOT_CATALOG_ID);

  private readonly coreConfig = computed<CoreConfig>(() => ({
    projects: this._appData().projects,
    lastOpenedProjectId: this._appData().currentProject?.id ?? null,
    globalSettings: this._appData().globalSettings,
    ankiSettings: this._appData().ankiSettings,
    catalogs: this._appData().catalogs,
    lastActiveCatalogId: this._activeCatalogId()
  }));

  public readonly projects = computed(() => {
    return this._appData().projects.sort((a, b) => b.lastOpenedDate - a.lastOpenedDate);
  });

  public readonly currentProjectId = computed(() => this._appData().currentProject?.id ?? null);
  public readonly currentProject = computed(() => this._appData().currentProject);

  public readonly globalSettings = computed(() => this._appData().globalSettings);
  public readonly ankiSettings = computed(() => this._appData().ankiSettings);

  public readonly catalogs = computed(() => this._appData().catalogs.sort((a, b) => a.name.localeCompare(b.name)));
  public readonly activeCatalogId = this._activeCatalogId.asReadonly();

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
      let requiresSave = false;

      mergedData.projects.forEach(p => {
        if (!p.catalogId) {
          p.catalogId = ROOT_CATALOG_ID;
        }
      });

      if (mergedData.currentProject && !mergedData.currentProject.catalogId) {
        mergedData.currentProject.catalogId = ROOT_CATALOG_ID;
      }

      mergedData.catalogs.forEach(c => {
        if (!c.parentId) {
          c.parentId = ROOT_CATALOG_ID;
        }
      });

      if (data.globalSettings?.subtitleLookupServices) {
        mergedData.globalSettings.subtitleLookupServices = data.globalSettings.subtitleLookupServices;
      }

      mergedData.globalSettings.subtitleLookupServices.forEach(service => {
        if (!service.type) {
          service.type = 'search';
          requiresSave = true;
        }
      });

      if (!data.globalSettings?.migratedDefaultAiServices) {
        console.log('[AppState] Migrating default AI services...');

        const existingIds = new Set(mergedData.globalSettings.subtitleLookupServices.map(s => s.id));
        const aiServicesToAdd = [...DEFAULT_AI_SUBTITLE_LOOKUP_SERVICES];

        for (const service of aiServicesToAdd) {
          if (!existingIds.has(service.id)) {
            mergedData.globalSettings.subtitleLookupServices.push(service);
          }
        }

        mergedData.globalSettings.migratedDefaultAiServices = true;
        requiresSave = true;
      }

      const services = mergedData.globalSettings.subtitleLookupServices;
      const oldDeeplIndex = services.findIndex(s => s.id === 'deepl-es');

      if (oldDeeplIndex !== -1) {
        console.log('[Migration] Replacing legacy DeepL search with AI service...');
        services.splice(oldDeeplIndex, 1);

        if (!services.some(s => s.id === 'deepl-pl')) {
          const newDeepl = DEFAULT_AI_SUBTITLE_LOOKUP_SERVICES.find(s => s.id === 'deepl-pl');
          if (newDeepl) {
            services.splice(oldDeeplIndex, 0, newDeepl);
          }
        }

        requiresSave = true;
      }

      if (data.ankiSettings?.ankiCardTemplates) {
        mergedData.ankiSettings.ankiCardTemplates = data.ankiSettings.ankiCardTemplates;
      }

      if (mergedData.currentProject) {
        this.ensureProjectDefaults(mergedData.currentProject);
      }

      this._appData.set(mergedData);
      this.setActiveCatalogId(mergedData, data.lastActiveCatalogId);

      if (requiresSave) {
        setTimeout(() => {
          this.storageService.saveCoreConfig(this.coreConfig());
        });
      }
    }
  }

  public async getProjectById(projectId: string): Promise<Project | null> {
    if (this.currentProjectId() === projectId) {
      return this.currentProject();
    }

    const project = await this.storageService.getProjectById(projectId);

    if (project) {
      this.ensureProjectDefaults(project);
    }

    return project;
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

  public updateEntireProject(projectId: string, updates: Partial<Project>): void {
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

  public updatePartialProject(projectId: string, fields: Partial<Project>): void {
    if (fields.subtitles) {
      fields.lastSubtitleEndTime = fields.subtitles.length > 0
        ? Math.max(...fields.subtitles.map(s => s.endTime))
        : 0;
    }

    this._appData.update(currentData => {
      let currentProject = currentData.currentProject;
      let projects = currentData.projects;

      // Update current project if it matches
      if (currentProject?.id === projectId) {
        currentProject = {
          ...currentProject,
          ...fields
        };
      }

      // Update minimal project in projects list
      projects = projects.map(p => {
        if (p.id === projectId) {
          const updatedMinimalProject: MinimalProject = {
            ...p,
            catalogId: fields.catalogId !== undefined ? fields.catalogId : p.catalogId,
            mediaFileName: fields.mediaFileName !== undefined ? fields.mediaFileName : p.mediaFileName,
            subtitleFileName: fields.subtitleFileName !== undefined ? fields.subtitleFileName : p.subtitleFileName,
            mediaPath: fields.mediaPath !== undefined ? fields.mediaPath : p.mediaPath,
            lastOpenedDate: fields.lastOpenedDate !== undefined ? fields.lastOpenedDate : p.lastOpenedDate,
            lastPlaybackTime: fields.lastPlaybackTime !== undefined ? fields.lastPlaybackTime : p.lastPlaybackTime,
            duration: fields.duration !== undefined ? fields.duration : p.duration,
            subtitleCount: fields.subtitles !== undefined ? fields.subtitles.length : p.subtitleCount,
            lastSubtitleEndTime: fields.lastSubtitleEndTime !== undefined ? fields.lastSubtitleEndTime : p.lastSubtitleEndTime
          };
          return updatedMinimalProject;
        } else {
          return p;
        }
      });

      return {
        ...currentData,
        projects,
        currentProject
      };
    });

    this.storageService.updateProjectFields(projectId, fields);
  }

  public async setCurrentProject(projectId: string): Promise<void> {
    const projectToLoad = await this.storageService.getProjectById(projectId);
    if (!projectToLoad) {
      console.error(`Failed to set current project: Project with ID ${projectId} not found on disk.`);
      return;
    }

    this.ensureProjectDefaults(projectToLoad);
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

  public setActiveCatalog(catalogId: string | null): void {
    this._activeCatalogId.set(catalogId || ROOT_CATALOG_ID);
  }

  public isCatalogNameTaken(name: string, parentId: string, excludeCatalogId?: string): boolean {
    const catalogs = this._appData().catalogs;
    const normalizedName = name.trim().toLowerCase();

    return catalogs.some(c =>
      c.parentId === parentId &&
      c.id !== excludeCatalogId &&
      c.name.trim().toLowerCase() === normalizedName
    );
  }

  public createCatalog(catalog: Catalog): void {
    if (this.isCatalogNameTaken(catalog.name, catalog.parentId)) {
      throw new DuplicateCatalogError(`A catalog named "${catalog.name}" already exists in this location.`);
    }

    this._appData.update(data => ({
      ...data,
      catalogs: [...data.catalogs, catalog]
    }));
  }

  public updateCatalog(id: string, updates: Partial<Catalog>): void {
    const currentCatalog = this._appData().catalogs.find(c => c.id === id);
    if (!currentCatalog) {
      return;
    }

    // Validate name uniqueness if name or parent is changing
    const newName = (updates.name !== undefined) ? updates.name : currentCatalog.name;
    const newParentId = (updates.parentId !== undefined) ? updates.parentId : currentCatalog.parentId;

    // Only validate if something relevant actually changed
    const isMoving = (updates.parentId !== undefined) && (updates.parentId !== currentCatalog.parentId);
    const isRenaming = (updates.name !== undefined) && (updates.name !== currentCatalog.name);

    if ((isMoving || isRenaming) && this.isCatalogNameTaken(newName, newParentId, id)) {
      throw new DuplicateCatalogError(`A catalog named "${newName}" already exists in the destination.`);
    }

    this._appData.update(data => ({
      ...data,
      catalogs: data.catalogs.map(c => c.id === id ? {...c, ...updates} : c)
    }));
  }

  public deleteCatalog(catalogId: string): void {
    const hasProjects = this._appData().projects.some(p => p.catalogId === catalogId);
    const hasSubCatalogs = this._appData().catalogs.some(c => c.parentId === catalogId);

    if (hasProjects || hasSubCatalogs) {
      console.error("Cannot delete non-empty catalog");
      return;
    }

    this._appData.update(data => ({
      ...data,
      catalogs: data.catalogs.filter(c => c.id !== catalogId)
    }));

    // If currently active catalog was deleted, default to root
    if (this._activeCatalogId() === catalogId) {
      this._activeCatalogId.set(ROOT_CATALOG_ID);
    }
  }

  public moveProjectToCatalog(projectId: string, catalogId: string): void {
    // Update in-memory minimal list
    this._appData.update(data => ({
      ...data,
      projects: data.projects.map(p => p.id === projectId ? {...p, catalogId} : p)
    }));

    // If this project is currently loaded in detail view, update it too
    const current = this.currentProject();
    if (current && current.id === projectId) {
      this.updatePartialProject(projectId, {catalogId});
    } else {
      // Otherwise perform a disk patch
      this.storageService.updateProjectFields(projectId, {catalogId});
    }
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
      lastSubtitleEndTime: project.lastSubtitleEndTime,
      catalogId: project.catalogId
    };
  }

  /**
   * Applies any missing default fields to a project object loaded from storage.
   * This handles migrations when new settings in DEFAULT_PROJECT_SETTINGS are added.
   */
  private ensureProjectDefaults(project: Project): void {
    this.migrateLanguageCodeForProject(project);
    project.settings = merge({}, DEFAULT_PROJECT_SETTINGS, project.settings);
  }

  private migrateLanguageCodeForProject(project: Project) {
    const detectedLanguage = normalizeLanguageCode(project.detectedLanguage);
    const selectedLanguage = normalizeLanguageCode(project.settings.subtitlesLanguage);

    if ((project.detectedLanguage !== detectedLanguage) || (project.settings.subtitlesLanguage !== selectedLanguage)) {
      console.log(`[Migration] Updating project language from ${project.detectedLanguage}/${project.settings.subtitlesLanguage} to ${detectedLanguage}/${selectedLanguage}`);
      project.detectedLanguage = detectedLanguage;
      project.settings.subtitlesLanguage = selectedLanguage;
    }
  }

  private setActiveCatalogId(mergedData: AppData, lastActiveCatalogId?: string) {
    let targetCatalogId = lastActiveCatalogId;

    const isValid = targetCatalogId === ROOT_CATALOG_ID || mergedData.catalogs.some(c => c.id === targetCatalogId);

    if (!isValid) {
      targetCatalogId = ROOT_CATALOG_ID;
    }

    this._activeCatalogId.set(targetCatalogId!);
  }
}
