import {AnkiExportRequest} from './app/model/anki.types';
import {SubtitleData} from '../shared/types/subtitle.type';

export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (filePath: string) => Promise<SubtitleData[]>;
  // --- Anki
  checkAnkiConnection: () => Promise<any>;
  getAnkiDeckNames: () => Promise<any>;
  getAnkiNoteTypes: () => Promise<any>;
  getAnkiNoteTypeFieldNames: (noteTypeName: string) => Promise<any>;
  exportAnkiCard: (exportRquest: AnkiExportRequest) => Promise<{ cardId: number | null; error?: string }>;
  // --- FFmpeg
  checkFFmpegAvailability: () => Promise<boolean>;
  // --- MPV
  mpvCreateViewport: (mediaPath: string) => Promise<void>;
  mpvHideVideoDuringResize: () => Promise<void>;
  mpvFinishVideoResize: (rect: {x: number, y: number, width: number, height: number}) => Promise<void>;
  mpvCommand: (commandArray: any[]) => Promise<void>;
  mpvGetProperty: (property: string) => Promise<any>;
  mpvSetProperty: (property: string, value: any) => Promise<void>;
  onMpvEvent: (callback: (status: any) => void) => void;
  onMainWindowMoved: (callback: () => void) => void;
  onMpvManagerReady: (callback: () => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
