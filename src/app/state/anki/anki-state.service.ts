import {computed, inject, Injectable, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiConnectStatus} from '../../model/anki.types';
import {AppStateService} from '../app/app-state.service';

@Injectable({
  providedIn: 'root'
})
export class AnkiStateService {
  readonly status = signal<AnkiConnectStatus>(AnkiConnectStatus.disconnected);
  readonly deckNames = signal<string[]>([]);
  readonly noteTypes = signal<string[]>([]);
  readonly noteTypeFields = signal<Record<string, string[]>>({});
  readonly isLoadingDecks = signal(false);
  readonly isLoadingNoteTypes = signal(false);
  readonly isLoadingNoteTypeFields = signal(false);
  readonly ankiCardTemplates = computed(() => this.appStateService.ankiSettings().ankiCardTemplates);
  readonly isAnkiExportAvailable = signal(false);
  readonly ankiGlobalTags = computed(() => this.appStateService.ankiSettings().tags);
  private readonly appStateService = inject(AppStateService);

  constructor() {
    this.checkAnkiConnection();
    this.checkFFmpegAvailability();
  }

  async checkAnkiConnection(): Promise<void> {
    this.status.set(AnkiConnectStatus.checking);
    this.deckNames.set([]);
    this.noteTypes.set([]);

    try {
      const result = await window.electronAPI.checkAnkiConnection();

      if (result !== null && typeof result === 'number') {
        this.status.set(AnkiConnectStatus.connected);
        await Promise.all([
          this.fetchDeckNames(),
          this.fetchNoteTypes()
        ]);
      } else {
        this.status.set(AnkiConnectStatus.disconnected);
      }
    } catch (e) {
      this.status.set(AnkiConnectStatus.error);
    }
  }

  private async checkFFmpegAvailability(): Promise<void> {
    const isAvailable = await window.electronAPI.checkFFmpegAvailability();
    this.isAnkiExportAvailable.set(isAvailable);
  }

  async fetchDeckNames(): Promise<void> {
    if (this.status() !== AnkiConnectStatus.connected) {
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
    if (this.status() !== AnkiConnectStatus.connected) {
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

  async fetchNoteTypeFields(noteTypeName: string): Promise<string[]> {
    if (this.status() !== AnkiConnectStatus.connected || !noteTypeName) {
      return [];
    }

    // Return cached data if it already exists
    if (this.noteTypeFields()[noteTypeName]) {
      return this.noteTypeFields()[noteTypeName];
    }

    this.isLoadingNoteTypeFields.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypeFieldNames(noteTypeName);
      const finalNames = names || [];
      this.noteTypeFields.update(data => ({...data, [noteTypeName]: finalNames}));
      return finalNames;
    } catch (e) {
      console.error(`Failed to fetch fields for ${noteTypeName}`, e);
      return [];
    } finally {
      this.isLoadingNoteTypeFields.set(false);
    }
  }

  addAnkiCardTemplate(template: AnkiCardTemplate): void {
    const currentTemplates = this.ankiCardTemplates();
    this.appStateService.updateAnkiSettings({ankiCardTemplates: [...currentTemplates, template]});
  }

  updateAnkiCardTemplate(id: string, updates: AnkiCardTemplate): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.map(t => t.id === id ? updates : t);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  deleteCardTemplate(id: string): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.filter(t => t.id !== id);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  setAnkiGlobalTags(tags: string[]): void {
    this.appStateService.updateAnkiSettings({tags});
  }
}
