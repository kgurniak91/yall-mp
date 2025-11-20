import {GlobalSettings, ProjectSettings} from './settings.types';
import type {SubtitleData} from '../../../shared/types/subtitle.type';
import {AnkiSettings} from './anki.types';
import {MediaTrack} from '../../../shared/types/media.type';

export type SupportedLanguage = 'jpn' | 'cmn' | 'zho' | 'tha' | 'other';

export type SubtitleSelection =
  | { type: 'none' }
  | { type: 'external'; filePath: string }
  | { type: 'embedded'; trackIndex: number; };

export type LookupNotes = Record<string, string[]>;

export interface ProjectClipNotes {
  lookupNotes?: LookupNotes;
  manualNote?: string;
}

export interface MinimalProject {
  id: string;
  mediaFileName: string;
  subtitleFileName: string;
  mediaPath: string;
  createdDate: number;
  lastOpenedDate: number;
  duration: number;
  lastPlaybackTime: number;
  subtitleCount: number;
  lastSubtitleEndTime: number;
}

export interface Project {
  id: string;
  mediaFileName: string;
  subtitleFileName: string;
  mediaPath: string;
  subtitleSelection: SubtitleSelection;
  lastOpenedDate: number;
  createdDate: number;
  duration: number;
  lastPlaybackTime: number;
  detectedLanguage: SupportedLanguage;
  settings: ProjectSettings;
  subtitles: SubtitleData[];
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  rawAssContent?: string;
  videoWidth?: number;
  videoHeight?: number;
  styles?: any;
  notes?: Record<string, ProjectClipNotes>;
  selectedAnkiTemplateIds?: string[];
  ankiTags: string[];
  lastAnkiSuspendState?: boolean;
  ankiExportHistory?: string[]; // List of SubtitleData IDs
  lastSubtitleEndTime: number;
  audioPeaks?: number[][];
}

/**
 * Represents in-memory app state (combined on init from yall-mp-app-data.json and single current project from /projects folder)
 */
export interface AppData {
  projects: MinimalProject[];
  currentProject: Project | null;
  globalSettings: GlobalSettings;
  ankiSettings: AnkiSettings;
}

/**
 * Represents on-disk app state (stored in yall-mp-app-data.json)
 */
export interface CoreConfig {
  projects: MinimalProject[];
  lastOpenedProjectId: string | null;
  globalSettings: GlobalSettings;
  ankiSettings: AnkiSettings;
}
