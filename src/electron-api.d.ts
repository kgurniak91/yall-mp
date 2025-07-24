import {AnkiCard} from './app/model/anki.types';
import {SubtitleData} from '../shared/types/subtitle.type';

export interface IElectronAPI {
  openFileDialog: (options: any) => Promise<string[]>;
  parseSubtitleFile: (filePath: string) => Promise<SubtitleData[]>;
  checkAnkiConnection: () => Promise<any>;
  getAnkiDeckNames: () => Promise<any>;
  getAnkiNoteTypes: () => Promise<any>;
  getAnkiNoteTypeFieldNames: (noteTypeName: string) => Promise<any>;
  createAnkiCard: (ankiCard: AnkiCard) => Promise<number | null>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
