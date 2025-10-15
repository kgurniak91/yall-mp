import {Component, inject} from '@angular/core';
import {Button} from 'primeng/button';
import {Fieldset} from 'primeng/fieldset';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ConfirmationService} from 'primeng/api';
import {DialogService} from 'primeng/dynamicdialog';
import {AnkiTemplateFormDialogComponent} from './anki-template-form-dialog/anki-template-form-dialog.component';
import {AnkiCardTemplate, AnkiConnectStatus} from '../../../model/anki.types';
import {TableModule} from 'primeng/table';
import {Tooltip} from 'primeng/tooltip';
import {v4 as uuidv4} from 'uuid';
import {TagsInputComponent} from '../../../shared/components/tags-input/tags-input.component';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-anki-settings',
  imports: [
    Button,
    Fieldset,
    TableModule,
    Tooltip,
    TagsInputComponent,
    FormsModule
  ],
  templateUrl: './anki-settings.component.html',
  styleUrl: './anki-settings.component.scss'
})
export class AnkiSettingsComponent {
  protected readonly AnkiConnectStatus = AnkiConnectStatus;
  protected readonly ankiStateService = inject(AnkiStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);

  protected onAddNewTemplate(): void {
    const ref = this.dialogService.open(AnkiTemplateFormDialogComponent, {
      header: 'Add New Anki Template',
      width: 'clamp(20rem, 95vw, 40rem)',
      modal: true
    });

    ref.onClose.subscribe((templateData: AnkiCardTemplate) => {
      if (templateData) {
        this.ankiStateService.addAnkiCardTemplate({...templateData, id: uuidv4()});
        this.toastService.success('Template added successfully.');
      }
    });
  }

  protected onEditTemplate(template: AnkiCardTemplate): void {
    const ref = this.dialogService.open(AnkiTemplateFormDialogComponent, {
      header: `Edit "${template.name}"`,
      width: 'clamp(20rem, 95vw, 40rem)',
      modal: true,
      data: {template}
    });

    ref.onClose.subscribe((templateData: AnkiCardTemplate) => {
      if (templateData) {
        this.ankiStateService.updateAnkiCardTemplate(template.id, templateData);
        this.toastService.success('Template updated successfully.');
      }
    });
  }

  protected onDeleteTemplate(id: string): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Are you sure you want to delete this template?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => {
        this.ankiStateService.deleteCardTemplate(id);
        this.toastService.success('Template deleted.');
      }
    });
  }
}
