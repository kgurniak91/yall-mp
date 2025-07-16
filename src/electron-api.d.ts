export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (filePath: string) => Promise<VTTCue[] | null>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
