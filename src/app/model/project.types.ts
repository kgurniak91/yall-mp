import {GlobalSettings, ProjectSettings} from './settings.types';
import type {SubtitleData} from '../../../shared/types/subtitle.type';

export interface Project {
  id: string;
  mediaFileName: string;
  subtitleFileName: string;
  mediaPath: string;
  subtitlePath: string;
  lastOpenedDate: number;
  createdDate: number;
  duration: number;
  lastPlaybackTime: number;
  settings: ProjectSettings;
  subtitles: SubtitleData[];
}

export interface AppData {
  projects: Project[];
  lastOpenedProjectId: string | null;
  globalSettings: GlobalSettings;
}
