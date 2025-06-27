export interface Project {
  id: number;
  name: string;
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
  lastOpenedProjectId: number | null;
}
