import {Component, input, output} from '@angular/core';
import {AnkiCardTemplate, AnkiFieldMapping, AnkiFieldMappingSource} from '../../../../model/anki.types';
import {Button} from 'primeng/button';
import {FormsModule} from '@angular/forms';
import {InputText} from 'primeng/inputtext';
import {Select} from 'primeng/select';
import {Fieldset} from 'primeng/fieldset';

const APP_DATA_SOURCES: AnkiFieldMappingSource[] = ['text', 'audio', 'screenshot', 'video'];

@Component({
  selector: 'app-anki-card-template-form',
  imports: [
    Button,
    FormsModule,
    InputText,
    Select,
    Fieldset
  ],
  templateUrl: './anki-card-template-form.component.html',
  styleUrl: './anki-card-template-form.component.scss'
})
export class AnkiCardTemplateFormComponent {
  template = input.required<AnkiCardTemplate>();
  decks = input<string[]>([]);
  noteTypes = input<string[]>([]);
  fields = input<string[]>([]);
  update = output<AnkiCardTemplate>();
  delete = output<void>();
  protected readonly appSources = APP_DATA_SOURCES;

  protected getSourceForField(fieldName: string): string | undefined {
    return this.template().fieldMappings.find(m => m.destination === fieldName)?.source;
  }

  onFieldChange<K extends keyof AnkiCardTemplate>(key: K, value: AnkiCardTemplate[K]): void {
    let updates: Partial<AnkiCardTemplate> = {[key]: value};
    if (key === 'ankiNoteType') {
      updates.fieldMappings = [];
    }
    this.update.emit({...this.template(), ...updates});
  }

  onMappingChange(fieldName: string, source: AnkiFieldMappingSource): void {
    const tmpl = this.template();
    const existingMappings = tmpl.fieldMappings.filter(m => m.destination !== fieldName);
    const newMapping: AnkiFieldMapping = {destination: fieldName, source: source};
    this.update.emit({...tmpl, fieldMappings: [...existingMappings, newMapping]});
  }
}
