export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (filePath: string) => Promise<SubtitleData[]>;
  checkAnkiConnection: () => Promise<any>;
  getAnkiDeckNames: () => Promise<any>;
  getAnkiNoteTypes: () => Promise<any>;
  getAnkiNoteTypeFieldNames: (noteTypeName: string) => Promise<any>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
