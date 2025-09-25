import {AnkiExportRequest} from './app/model/anki.types';
import {AppData, SubtitleSelection} from './app/model/project.types';
import {VideoClip} from './app/model/video.types';
import {ProjectSettings} from './app/model/settings.types';
import {SubtitleData} from '../shared/types/subtitle.type';
import {MediaMetadata} from '../shared/types/media.type';
import {PlaybackStateUpdate} from '../playback-manager';

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
  mpvGetProperty: (property: string) => Promise<any>;
  mpvSetProperty: (property: string, value: any) => Promise<void>;
  mpvDestroyViewport: () => void;
  onMpvEvent: (callback: (status: any) => void) => (() => void);
  onMainWindowMoved: (callback: () => void) => void;
  onMpvManagerReady: (callback: () => void) => void;
  onMpvInitialSeekComplete: (callback: () => void) => (() => void);
  // --- Storage
  getAppData: () => Promise<AppData | null>;
  setAppData: (data: AppData) => Promise<void>;
  // --- Playback
  playbackPlay: () => void;
  playbackPause: () => void;
  playbackTogglePlayPause: () => void;
  playbackRepeat: () => void;
  playbackForceContinue: () => void;
  playbackSeek: (time: number) => void;
  playbackLoadProject: (clips: VideoClip[], settings: ProjectSettings) => Promise<void>;
  playbackUpdateSettings: (settings: ProjectSettings) => void;
  onPlaybackStateUpdate: (callback: (update: PlaybackStateUpdate) => void) => (() => void);
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
