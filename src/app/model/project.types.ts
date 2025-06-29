export interface Project {
  id: string;
  mediaFileName: string;
  subtitleFileName: string;
  mediaFileHandle?: FileSystemFileHandle;
  subtitleFileHandle?: FileSystemFileHandle;
  videoUrl: string;
  subtitleUrl: string;
  lastOpenedDate: number;
  createdDate: number;
  duration: number;
  lastPlaybackTime: number;
  lastSubtitledClipEndTime: number;
  subtitledClipsCount: number;
}

export interface AppData {
  projects: Project[];
  lastOpenedProjectId: string | null;
}
