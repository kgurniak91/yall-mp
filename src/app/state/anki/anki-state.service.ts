import {Injectable, signal} from '@angular/core';
import {AnkiConnectStatus} from '../../model/anki.types';

@Injectable({
  providedIn: 'root'
})
export class AnkiStateService {
  readonly status = signal<AnkiConnectStatus>('disconnected');
  readonly deckNames = signal<string[]>([]);
  readonly noteTypes = signal<string[]>([]);
  readonly noteTypeFields = signal<string[]>([]);
  readonly isLoadingDecks = signal(false);
  readonly isLoadingNoteTypes = signal(false);
  readonly isLoadingNoteTypeFields = signal(false);

  constructor() {
    this.checkAnkiConnection();
  }

  async checkAnkiConnection(): Promise<void> {
    this.status.set('checking');
    this.deckNames.set([]);
    this.noteTypes.set([]);

    try {
      const result = await window.electronAPI.checkAnkiConnection();

      if (result !== null && typeof result === 'number') {
        this.status.set('connected');
        await Promise.all([
          this.fetchDeckNames(),
          this.fetchNoteTypes()
        ]);
      } else {
        this.status.set('disconnected');
      }
    } catch (e) {
      this.status.set('error');
    }
  }

  async fetchDeckNames(): Promise<void> {
    if (this.status() !== 'connected') {
      return;
    }

    this.isLoadingDecks.set(true);
    try {
      const names = await window.electronAPI.getAnkiDeckNames();
      if (names) {
        this.deckNames.set(names.sort());
        console.log('Fetched deck names:', names);
      } else {
        this.deckNames.set([]);
        console.error('Failed to fetch deck names, API returned null.');
      }
    } catch (e) {
      console.error('An unexpected error occurred while fetching deck names:', e);
      this.deckNames.set([]);
    } finally {
      this.isLoadingDecks.set(false);
    }
  }

  async fetchNoteTypes(): Promise<void> {
    if (this.status() !== 'connected') {
      return;
    }

    this.isLoadingNoteTypes.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypes();
      if (names) {
        this.noteTypes.set(names.sort());
        console.log('Fetched note types:', names);
      } else {
        this.noteTypes.set([]);
        console.error('Failed to fetch note types, API returned null.');
      }
    } catch (e) {
      console.error('An unexpected error occurred while fetching note types:', e);
      this.noteTypes.set([]);
    } finally {
      this.isLoadingNoteTypes.set(false);
    }
  }

  async fetchNoteTypeFields(noteTypeName: string): Promise<void> {
    if (this.status() !== 'connected' || !noteTypeName) {
      this.noteTypeFields.set([]);
      return;
    }

    this.isLoadingNoteTypeFields.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypeFieldNames(noteTypeName);
      console.log('Fetched note type fields:', names);
      this.noteTypeFields.set(names || []);
    } catch (e) {
      this.noteTypeFields.set([]);
      console.error('An error occurred fetching note type fields:', e);
    } finally {
      this.isLoadingNoteTypeFields.set(false);
    }
  }
}
