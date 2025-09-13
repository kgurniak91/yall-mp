import {GlobalSettings, ProjectSettings} from './settings.types';
import type {SubtitleData} from '../../../shared/types/subtitle.type';
import {AnkiSettings} from './anki.types';
import {MediaTrack} from '../../../shared/types/media.type';
import {FontData} from '../../electron-api';

export type SubtitleSelection =
  | { type: 'none' }
  | { type: 'external'; filePath: string }
  | { type: 'embedded'; trackIndex: number; };

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
  settings: ProjectSettings;
  subtitles: SubtitleData[];
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  rawAssContent?: string;
  videoWidth?: number;
  videoHeight?: number;
  styles?: any;
}

export interface AppData {
  projects: Project[];
  lastOpenedProjectId: string | null;
  globalSettings: GlobalSettings;
  ankiSettings: AnkiSettings;
}
