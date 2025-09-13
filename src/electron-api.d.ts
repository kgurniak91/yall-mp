import {AnkiExportRequest} from './app/model/anki.types';
import {AppData, SubtitleSelection} from './app/model/project.types';
import {SubtitleData} from '../shared/types/subtitle.type';
import {MediaMetadata} from '../shared/types/media.type';

export interface MpvClipRequest {
  startTime: number;
  endTime: number;
  playbackRate: number;
}

export interface FontData {
  fontFamily: string;
  dataUri: string;
}

export interface ParsedSubtitlesData {
  subtitles: SubtitleData[];
  rawAssContent?: string;
  styles?: any;
}

export interface IElectronAPI {
  // --- Window control
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowToggleFullScreen: () => void;
  windowEscape: () => void;
  windowHandleDoubleClick: () => void;
  windowClose: () => void;
  onWindowMaximizedStateChanged: (callback: (isMaximized: boolean) => void) => void;
  onWindowFullScreenStateChanged: (callback: (isFullScreen: boolean) => void) => void;
  windowUpdateDraggableZones: (shapes: { x: number, y: number, width: number, height: number }[]) => Promise<void>;
  // --- Files
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (projectId: string, filePath: string) => Promise<ParsedSubtitlesData>;
  getMediaMetadata: (filePath: string) => Promise<MediaMetadata>;
  extractSubtitleTrack: (projectId: string, mediaPath: string, trackIndex: number) => Promise<ParsedSubtitlesData>;
  getPathForFile: (file: File) => string;
  getProjectFonts: (projectId: string) => Promise<FontData[]>;
  deleteProjectFonts: (projectId: string) => void;
  // --- Anki
  checkAnkiConnection: () => Promise<any>;
  getAnkiDeckNames: () => Promise<any>;
  getAnkiNoteTypes: () => Promise<any>;
  getAnkiNoteTypeFieldNames: (noteTypeName: string) => Promise<any>;
  exportAnkiCard: (exportRquest: AnkiExportRequest) => Promise<{ cardId: number | null; error?: string }>;
  // --- FFmpeg
  checkFFmpegAvailability: () => Promise<boolean>;
  // --- MPV
  mpvCreateViewport: (
    mediaPath: string, audioTrackIndex: number | null, subtitleSelection: SubtitleSelection, useMpvSubtitles: boolean
  ) => Promise<void>;
  mpvFinishVideoResize: (rect: { x: number, y: number, width: number, height: number }) => Promise<void>;
  mpvCommand: (commandArray: any[]) => Promise<void>;
  mpvPlayClip: (request: MpvClipRequest) => Promise<void>;
  mpvGetProperty: (property: string) => Promise<any>;
  mpvSetProperty: (property: string, value: any) => Promise<void>;
  mpvSeekAndPause: (seekTime: number) => Promise<void>;
  onMpvEvent: (callback: (status: any) => void) => (() => void);
  onMainWindowMoved: (callback: () => void) => void;
  onMpvManagerReady: (callback: () => void) => void;
  onMpvInitialSeekComplete: (callback: () => void) => (() => void);
  // --- Storage
  getAppData: () => Promise<AppData | null>;
  setAppData: (data: AppData) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
