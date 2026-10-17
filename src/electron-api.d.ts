import {AnkiBatchExportRequest} from './app/model/anki.types';
import {AppData, CoreConfig, Project, SubtitleSelection, SupportedLanguage} from './app/model/project.types';
import {LightweightVideoClip} from './app/model/video.types';
import {ProjectSettings} from './app/model/settings.types';
import {SubtitleData} from '../shared/types/subtitle.type';
import {MediaMetadata, MediaTrack} from '../shared/types/media.type';
import {PlaybackStateUpdate} from '../playback-manager';

export type MenuAction =
  | 'new-project' | 'project-list' | 'edit-project' | 'delete-project'
  | 'previous-media' | 'next-media'
  | 'undo' | 'redo' | 'find-subtitles' | 'dictionary' | 'transform-subtitles'
  | 'settings' | 'help';

export interface FontData {
  fontFamily: string;
  dataUri: string;
}

export interface ParsedSubtitlesData {
  subtitles: SubtitleData[];
  rawAssContent?: string;
  styles?: any;
  detectedLanguage: SupportedLanguage;
}

export interface ExecutableInUse {
  path: string | null;
  version: string | null;
  hardwareDecoder?: boolean;            // ffmpeg only
  av1Decoder?: 'dav1d' | 'libaom' | 'none';
  homebrewMissing?: boolean;            // macOS: Homebrew's ffmpeg is not installed
}

export interface IElectronAPI {
  getExecutablesInUse: () => Promise<Record<string, ExecutableInUse>>;
  // --- App
  platform: NodeJS.Platform;
  getAppVersion: () => Promise<string>;
  appSetTheme: (theme: 'system' | 'light' | 'dark') => void;
  // --- Window control
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowToggleFullScreen: () => void;
  windowEscape: () => void;
  windowHandleDoubleClick: () => void;
  windowClose: () => void;
  windowStartManualResize: (direction: string) => void;
  windowStopManualResize: () => void;
  onWindowMaximizedStateChanged: (callback: (isMaximized: boolean) => void) => (() => void);
  onWindowFullScreenStateChanged: (callback: (isFullScreen: boolean) => void) => (() => void);
  windowUpdateDraggableZones: (shapes: { x: number, y: number, width: number, height: number }[]) => Promise<void>;
  openInSystemBrowser: (url: string) => Promise<void>;
  // --- Subtitles Lookup
  openSubtitlesLookupWindow: (data: {
    url: string;
    clipSubtitleId: string;
    originalSelection: string;
    automationText?: string;
  }) => Promise<void>;
  onProjectAddNote: (callback: (note: {
    clipSubtitleId: string;
    text: string;
    selection: string;
  }) => void) => (() => void);
  closeLookupWindow: () => void;
  onViewLoadingStateChange: (callback: (isLoading: boolean) => void) => (() => void);
  onLookupShowToast: (callback: (message: string) => void) => (() => void);
  onLookupWindowStateChange: (callback: (isVisible: boolean) => void) => (() => void);
  clearLookupData: () => Promise<void>;
  // --- Files
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (projectId: string, filePath: string) => Promise<ParsedSubtitlesData>;
  getMediaMetadata: (filePath: string) => Promise<MediaMetadata>;
  extractSubtitleTrack: (projectId: string, mediaPath: string, trackIndex: number) => Promise<ParsedSubtitlesData>;
  getPathForFile: (file: File) => string;
  getProjectFonts: (projectId: string) => Promise<FontData[]>;
  deleteProjectFonts: (projectId: string) => void;
  checkFileExists: (filePath: string) => Promise<boolean>;
  generateAudioPeaks: (projectId: string, mediaPath: string, audioTrackIndex?: number) => Promise<number[][] | null>;
  findAdjacentMedia: (currentPath: string, direction: 'next' | 'previous') => Promise<string | null>;
  findCompanionSubtitle: (mediaPath: string) => Promise<string | null>;
  // --- File Association ("Open with")
  getPendingOpenFiles: () => Promise<string[]>;
  onAppOpenFiles: (callback: (filePaths: string[]) => void) => (() => void);
  // --- Anki
  checkAnkiConnection: () => Promise<any>;
  getAnkiDeckNames: () => Promise<any>;
  getAnkiNoteTypes: () => Promise<any>;
  getAnkiNoteTypeFieldNames: (noteTypeName: string) => Promise<any>;
  exportAnkiCardBatch: (batchRequest: AnkiBatchExportRequest) => Promise<{ successCount: number; failedCount?: number; error?: string }>;
  // --- FFmpeg
  checkFFmpegAvailability: () => Promise<boolean>;
  // --- MPV
  mpvCreateViewport: (
    mediaPath: string,
    audioTrackIndex: number | null,
    subtitleSelection: SubtitleSelection,
    subtitleTracks: MediaTrack[],
    useMpvSubtitles: boolean,
    subtitlesVisible: boolean,
    hardwareAcceleration: boolean,
    volume: number,
    isMuted: boolean
  ) => Promise<void>;
  /** `viewport` is the page size; with it the macOS window is kept in the video's shape. */
  mpvFinishVideoResize: (rect: { x: number, y: number, width: number, height: number }, viewport?: {width: number, height: number}) => Promise<void>;
  /** macOS live resize: moves the native video view immediately (no reply). */
  mpvSetVideoBounds: (rect: {x: number, y: number, width: number, height: number}, viewport?: {width: number, height: number}) => void;
  mpvCommand: (commandArray: any[]) => Promise<void>;
  mpvGetProperty: (property: string) => Promise<any>;
  mpvSetProperty: (property: string, value: any) => Promise<void>;
  mpvShowSubtitles: () => Promise<void>;
  mpvHideSubtitles: () => Promise<void>;
  onMpvDestroyViewport: () => Promise<void>;
  onMpvEvent: (callback: (status: any) => void) => (() => void);
  onMainWindowMovedOrResized: (callback: () => void) => (() => void);
  onMpvManagerReady: (callback: () => void) => (() => void);
  /** True when the window uses the system title strip and menu bar (macOS). */
  nativeWindowChrome: boolean;
  windowSetTitle: (title: string) => void;
  /** macOS: show or hide the traffic lights (they follow the auto-hidden title strip). */
  windowSetButtonsVisible: (visible: boolean) => void;
  /** Items of the macOS menu bar; the header component performs them. */
  onMenuAction: (callback: (action: MenuAction) => void) => (() => void);
  /** macOS media keys (F8 play/pause, F7/F9 previous/next) routed through mpv. */
  onMediaKey: (callback: (action: 'play-pause' | 'next' | 'previous') => void) => (() => void);
  onMpvInitialSeekComplete: (callback: () => void) => (() => void);
  onMpvVideoVisibilityChange: (callback: (isVisible: boolean) => void) => (() => void);
  // --- Storage
  getAppData: () => Promise<AppData | null>;
  getProjectById: (projectId: string) => Promise<Project | null>;
  saveProject: (project: Project) => Promise<void>;
  updateProjectFields: (projectId: string, fields: Partial<Project>) => Promise<void>;
  deleteProjectFile: (projectId: string) => Promise<void>;
  saveCoreConfig: (config: CoreConfig) => Promise<void>;
  // --- Playback
  playbackPlay: () => void;
  playbackPause: () => void;
  playbackTogglePlayPause: () => void;
  playbackToggleSubtitles: () => void;
  playbackRepeat: () => void;
  playbackForceContinue: () => void;
  playbackSeek: (time: number, isNavigation?: boolean) => void;
  playbackLoadProject: (
    clips: LightweightVideoClip[],
    settings: ProjectSettings,
    lastPlaybackTime: number,
    cinemaMode: {
      enabled: boolean;
      speed: number
    }
  ) => Promise<void>;
  playbackUpdateSettings: (settings: ProjectSettings) => void;
  playbackUpdateClips: (clips: LightweightVideoClip[], currentTime?: number) => void;
  playbackSetCinemaMode: (options: { enabled: boolean; speed: number }) => void;
  onPlaybackStateUpdate: (callback: (update: PlaybackStateUpdate) => void) => (() => void);
  onRepeatSeekCompleted: (callback: () => void) => (() => void);
  playbackSetSpeedOverride: (isActive: boolean) => void;
  playbackSetVolume: (volume: number) => void;
  playbackSetMute: (mute: boolean) => void;
  // --- Yomitan
  getYomitanExtensionId: () => Promise<string | null>;
  getYomitanSettingsUrl: () => Promise<string | null>;
  invokeExtension: (message: any) => Promise<any>;
  setYomitanLanguageFull: (languageIso: string) => Promise<any>;
  showContextMenu: (options: { text: string, allowNotes: boolean }) => Promise<string | null>;
  invokeExtensionReadyCheck: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
