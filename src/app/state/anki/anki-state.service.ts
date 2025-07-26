import {computed, effect, inject, Injectable, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiConnectStatus, AnkiFieldMappingSource} from '../../model/anki.types';
import {AppStateService} from '../app/app-state.service';
import {v4 as uuidv4} from 'uuid';

@Injectable({
  providedIn: 'root'
})
export class AnkiStateService {
  readonly status = signal<AnkiConnectStatus>('disconnected');
  readonly deckNames = signal<string[]>([]);
  readonly noteTypes = signal<string[]>([]);
  readonly noteTypeFields = signal<Record<string, string[]>>({});
  readonly isLoadingDecks = signal(false);
  readonly isLoadingNoteTypes = signal(false);
  readonly isLoadingNoteTypeFields = signal(false);
  readonly ankiCardTemplates = computed(() => this.appStateService.ankiSettings().ankiCardTemplates);
  readonly isAnkiExportAvailable = signal(false);
  private readonly appStateService = inject(AppStateService);

  constructor() {
    this.checkAnkiConnection();
    this.checkFFmpegAvailability();

    effect(() => {
      const templates = this.ankiCardTemplates();
      const fieldsMap = this.noteTypeFields();

      const validatedTemplates = templates.map(template => {
        const fields = template.ankiNoteType ? fieldsMap[template.ankiNoteType] || [] : [];
        return {...template, isValid: this.isTemplateValid(template, fields)};
      });

      if (JSON.stringify(templates) !== JSON.stringify(validatedTemplates)) {
        this.appStateService.updateAnkiSettings({ankiCardTemplates: validatedTemplates});
      }
    });
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

  private async checkFFmpegAvailability(): Promise<void> {
    const isAvailable = await window.electronAPI.checkFFmpegAvailability();
    this.isAnkiExportAvailable.set(isAvailable);
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
    if (this.status() !== 'connected' || !noteTypeName || this.noteTypeFields()[noteTypeName]) {
      return;
    }

    this.isLoadingNoteTypeFields.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypeFieldNames(noteTypeName);
      console.log('Fetched note type fields:', names);
      this.noteTypeFields.update(data => ({...data, [noteTypeName]: names || []}))
    } finally {
      this.isLoadingNoteTypeFields.set(false);
    }
  }

  addAnkiCardTemplate(): string {
    const newTemplate: AnkiCardTemplate = {
      id: uuidv4(),
      name: 'New Card Template',
      ankiDeck: null,
      ankiNoteType: null,
      fieldMappings: [],
      isValid: false
    };

    const currentTemplates = this.ankiCardTemplates();
    this.appStateService.updateAnkiSettings({ankiCardTemplates: [newTemplate, ...currentTemplates]});
    return newTemplate.id;
  }

  updateAnkiCardTemplate(id: string, updates: Partial<AnkiCardTemplate>): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.map(t => t.id === id ? {...t, ...updates} : t);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  public updateCardTemplate(id: string, updates: Partial<AnkiCardTemplate>): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.map(t => {
      if (t.id === id) {
        const updatedTemplate = { ...t, ...updates };
        if ('ankiNoteType' in updates && updates.ankiNoteType !== t.ankiNoteType) {
          updatedTemplate.fieldMappings = [];
        }
        return updatedTemplate;
      }
      return t;
    });
    this.appStateService.updateAnkiSettings({ ankiCardTemplates: newTemplates });
  }

  public deleteCardTemplate(id: string): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.filter(t => t.id !== id);
    this.appStateService.updateAnkiSettings({ ankiCardTemplates: newTemplates });
  }

  private isTemplateValid(template: AnkiCardTemplate, fieldsForNoteType: string[]): boolean {
    if (!template.name || !template.ankiDeck || !template.ankiNoteType) {
      return false;
    }

    const requiredSources: AnkiFieldMappingSource[] = ['id', 'text', 'audio'];
    const mappedSources = template.fieldMappings.map(m => m.source);
    return requiredSources.every(required => mappedSources.includes(required));
  }
}
