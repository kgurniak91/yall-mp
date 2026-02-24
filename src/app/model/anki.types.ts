import {SubtitleData} from '../../../shared/types/subtitle.type';
import {Project} from './project.types';

export type AnkiFieldMappingSource = 'id' | 'text' | 'audio' | 'screenshot' | 'video' | 'notes' | 'animation' | 'hint';

export interface AnkiFieldMapping {
  source: AnkiFieldMappingSource; // App's data fields
  destination: string; // The name of the field in the Anki Note Type
}

export interface AnkiDailyGoal {
  targetCount: number;
  notifyInterval: number; // 0 for "Only when reached", otherwise e.g., 1, 2, 5, 10, 20
  notifyAfterReached: boolean;
  playSound: boolean;
  enabled: boolean;
}

export interface AnkiTemplateProgress {
  count: number;
  goalReachedNotified: boolean;
}

export interface AnkiCardTemplate {
  id: string;
  name: string; // e.g., "Listening Practice Card"
  ankiDeck: string | null;
  ankiNoteType: string | null;
  fieldMappings: AnkiFieldMapping[];
  tags: string[];
  isDefault?: boolean;
  dailyGoal?: AnkiDailyGoal;
}

export enum AnkiConnectStatus {
  connected = 'connected',
  disconnected = 'disconnected',
  checking = 'checking',
  error = 'error'
}

export interface AnkiSettings {
  ankiCardTemplates: AnkiCardTemplate[];
  tags: string[];
  progressTracker?: Record<string, Record<string, AnkiTemplateProgress>>; // YYYY-MM-DD -> Template ID -> Progress
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

export interface AnkiTemplateTarget {
  template: AnkiCardTemplate;
  tags: string[];
}

export interface AnkiBatchExportRequest {
  subtitleData: SubtitleData;
  mediaPath: string;
  exportTime: number;
  notes: string;
  hint: string;
  suspend: boolean;
  targets: AnkiTemplateTarget[];
  audioTrackIndex?: number | null;
}

export interface ExportToAnkiDialogData {
  project: Project;
  subtitleData: SubtitleData;
  exportTime: number;
  instantExport: boolean;
}
