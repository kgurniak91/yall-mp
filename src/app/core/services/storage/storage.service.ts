import {Injectable} from '@angular/core';
import {AppData, CoreConfig, Project} from '../../../model/project.types';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  get(): Promise<AppData | null> {
    return window.electronAPI.getAppData();
  }

  getProjectById(projectId: string): Promise<Project | null> {
    return window.electronAPI.getProjectById(projectId);
  }

  saveProject(project: Project): void {
    window.electronAPI.saveProject(project).catch(err => {
      console.error(`Failed to save project ${project.id} through Electron API`, err);
    });
  }

  deleteProjectFile(projectId: string): void {
    window.electronAPI.deleteProjectFile(projectId).catch(err => {
      console.error(`Failed to delete project file ${projectId} through Electron API`, err);
    });
  }

  saveCoreConfig(config: CoreConfig): void {
    window.electronAPI.saveCoreConfig(config).catch(err => {
      console.error('Failed to save core config through Electron API', err);
    });
  }
}
