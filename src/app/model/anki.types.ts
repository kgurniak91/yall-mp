export interface AnkiFieldMapping {
  source: 'text' | 'audio' | 'screenshot' | 'video'; // App's data fields
  destination: string; // The name of the field in the Anki Note Type
}

export interface AnkiCardTemplate {
  id: string;
  name: string; // e.g., "Listening Practice Card"
  ankiDeck: string | null;
  ankiNoteType: string | null;
  fieldMappings: AnkiFieldMapping[];
}

export type AnkiConnectStatus = 'connected' | 'disconnected' | 'checking' | 'error';

export interface AnkiSettings {
  ankiCardTemplates: AnkiCardTemplate[];
}
