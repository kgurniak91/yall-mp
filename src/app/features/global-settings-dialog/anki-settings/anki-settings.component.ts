import {Component, computed, effect, inject, signal} from '@angular/core';
import {Button} from 'primeng/button';
import {Fieldset} from 'primeng/fieldset';
import {Select} from 'primeng/select';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {AppStateService} from '../../../state/app/app-state.service';
import {AnkiCardTemplate} from '../../../model/anki.types';
import {v4 as uuidv4} from 'uuid';
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel, AccordionTabOpenEvent} from 'primeng/accordion';
import {FormsModule} from '@angular/forms';
import {InputText} from 'primeng/inputtext';

@Component({
  selector: 'app-anki-settings',
  imports: [
    Button,
    Fieldset,
    Select,
    Accordion,
    AccordionPanel,
    AccordionHeader,
    AccordionContent,
    FormsModule,
    InputText
  ],
  templateUrl: './anki-settings.component.html',
  styleUrl: './anki-settings.component.scss'
})
export class AnkiSettingsComponent {
  protected selectedTemplateIndex = signal<number | undefined>(undefined);
  protected accordionActiveIndex = computed(() => {
    const selected = this.selectedTemplateIndex();
    return selected === undefined ? -1 : selected;
  });
  protected readonly ankiCardTemplates = computed(() => this.appStateService.ankiSettings().ankiCardTemplates);
  protected readonly ankiStateService = inject(AnkiStateService);
  private readonly appStateService = inject(AppStateService);

  constructor() {
    effect(() => {
      const index = this.selectedTemplateIndex();
      if (index !== undefined) {
        const template = this.ankiCardTemplates()[index];
        const noteType = template?.ankiNoteType;
        if (noteType) {
          this.ankiStateService.fetchNoteTypeFields(noteType);
        } else {
          this.ankiStateService.noteTypeFields.set([]);
        }
      } else {
        this.ankiStateService.noteTypeFields.set([]);
      }
    });
  }

  protected onTabOpen(event: AccordionTabOpenEvent): void {
    this.selectedTemplateIndex.set(event.index);
  }

  protected onTabClose(): void {
    this.selectedTemplateIndex.set(undefined);
  }

  protected addAnkiCardTemplate(): string {
    const newTemplate: AnkiCardTemplate = {
      id: uuidv4(),
      name: 'New Card Template',
      ankiDeck: null,
      ankiNoteType: null,
      fieldMappings: []
    };

    const currentTemplates = this.ankiCardTemplates();
    this.appStateService.updateAnkiSettings({ankiCardTemplates: [...currentTemplates, newTemplate]});
    return newTemplate.id;
  }

  protected updateAnkiCardTemplate(id: string, updates: Partial<AnkiCardTemplate>): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.map(t => t.id === id ? {...t, ...updates} : t);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  protected deleteAnkiCardTemplate(id: string): void {
    console.log('Deleting template:', id);
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.filter(t => t.id !== id);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

}
