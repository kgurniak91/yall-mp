import {SubtitleData} from '../../../shared/types/subtitle.type';
import {Project} from './project.types';

export type AnkiFieldMappingSource = 'id' | 'text' | 'audio' | 'screenshot' | 'video' | 'notes';

export interface AnkiFieldMapping {
  source: AnkiFieldMappingSource; // App's data fields
  destination: string; // The name of the field in the Anki Note Type
}

export interface AnkiCardTemplate {
  id: string;
  name: string; // e.g., "Listening Practice Card"
  ankiDeck: string | null;
  ankiNoteType: string | null;
  fieldMappings: AnkiFieldMapping[];
}

export enum AnkiConnectStatus {
  connected = 'connected',
  disconnected = 'disconnected',
  checking = 'checking',
  error = 'error'
}

export interface AnkiSettings {
  ankiCardTemplates: AnkiCardTemplate[];
}

export interface AnkiCard {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  options: {
    allowDuplicate: boolean;
  };
}

export interface AnkiExportRequest {
  template: AnkiCardTemplate;
  subtitleData: SubtitleData;
  mediaPath: string;
  exportTime: number;
  notes: string;
}

export interface ExportToAnkiDialogData {
  project: Project;
  subtitleData: SubtitleData;
  exportTime: number;
}
