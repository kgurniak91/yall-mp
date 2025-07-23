import {Component, computed, effect, inject, signal} from '@angular/core';
import {Button} from 'primeng/button';
import {Fieldset} from 'primeng/fieldset';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {Accordion, AccordionContent, AccordionHeader, AccordionPanel, AccordionTabOpenEvent} from 'primeng/accordion';
import {FormsModule} from '@angular/forms';
import {AnkiCardTemplateFormComponent} from './anki-card-template-form/anki-card-template-form.component';
import {Badge} from 'primeng/badge';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ConfirmationService} from 'primeng/api';

@Component({
  selector: 'app-anki-settings',
  imports: [
    Button,
    Fieldset,
    Accordion,
    AccordionPanel,
    AccordionHeader,
    AccordionContent,
    FormsModule,
    AnkiCardTemplateFormComponent,
    Badge
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
  protected readonly ankiStateService = inject(AnkiStateService);
  protected readonly fieldsForSelectedNoteType = computed(() => {
    const index = this.selectedTemplateIndex();
    if (index === undefined) return [];

    const template = this.ankiStateService.ankiCardTemplates()[index];
    if (!template?.ankiNoteType) return [];

    return this.ankiStateService.noteTypeFields()[template.ankiNoteType] || [];
  });
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);

  constructor() {
    effect(() => {
      const index = this.selectedTemplateIndex();
      if (index !== undefined) {
        const template = this.ankiStateService.ankiCardTemplates()[index];
        const noteType = template?.ankiNoteType;
        if (noteType) {
          this.ankiStateService.fetchNoteTypeFields(noteType);
        }
      }
    });
  }

  protected onTabOpen(event: AccordionTabOpenEvent): void {
    this.selectedTemplateIndex.set(event.index);
  }

  protected onTabClose(): void {
    this.selectedTemplateIndex.set(undefined);
  }

  protected onAddNewTemplate(): void {
    const invalidTemplate = this.ankiStateService.ankiCardTemplates().find(t => !t.isValid);

    if (invalidTemplate) {
      this.toastService.warn('Make sure all templates are valid before adding a new one.');
      return;
    }

    this.ankiStateService.addAnkiCardTemplate();
    this.selectedTemplateIndex.set(0);
  }

  protected onDeleteTemplate(id: string): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Are you sure you want to delete this template?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => {
        this.ankiStateService.deleteCardTemplate(id);
        this.selectedTemplateIndex.set(undefined);
      }
    });
  }
}
