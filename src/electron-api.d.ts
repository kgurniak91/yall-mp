export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (filePath: string) => Promise<SubtitleData[]>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
