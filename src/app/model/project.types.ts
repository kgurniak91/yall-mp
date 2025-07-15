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
  lastSubtitledClipEndTime: number;
  subtitledClipsCount: number;
}

export interface AppData {
  projects: Project[];
  lastOpenedProjectId: string | null;
}
