export interface Project {
  id: string;
  fileName: string;
  videoFileHandle?: FileSystemFileHandle;
  subtitleFileHandle?: FileSystemFileHandle;
  videoUrl: string;
  subtitleUrl: string;
  lastOpenedDate: number;
  lastModifiedDate: number;
  createdDate: number;
}

export interface AppData {
  projects: Project[];
  lastOpenedProjectId: string | null;
}
