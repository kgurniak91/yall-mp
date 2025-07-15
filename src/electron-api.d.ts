export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
