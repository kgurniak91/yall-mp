import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {Button} from 'primeng/button';
import {Fieldset} from 'primeng/fieldset';
import {AnkiStateService} from '../../../state/anki/anki-state.service';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {DialogService} from 'primeng/dynamicdialog';
import {AnkiTemplateFormDialogComponent} from './anki-template-form-dialog/anki-template-form-dialog.component';
import {AnkiCardTemplate, AnkiConnectStatus} from '../../../model/anki.types';
import {TableModule} from 'primeng/table';
import {Tooltip} from 'primeng/tooltip';
import {v4 as uuidv4} from 'uuid';
import {TagsInputComponent} from '../../../shared/components/tags-input/tags-input.component';
import {FormsModule} from '@angular/forms';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {Checkbox} from 'primeng/checkbox';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {DEFAULT_CONFIRMATION} from '../../../shared/types/confirmation.types';
import {Menu} from 'primeng/menu';
import {AnkiDailyGoalDialogComponent} from './anki-daily-goal-dialog/anki-daily-goal-dialog.component';

@Component({
  selector: 'app-anki-settings',
  imports: [
    Button,
    Fieldset,
    TableModule,
    Tooltip,
    TagsInputComponent,
    FormsModule,
    Checkbox,
    Menu
  ],
  templateUrl: './anki-settings.component.html',
  styleUrl: './anki-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnkiSettingsComponent {
  protected readonly AnkiConnectStatus = AnkiConnectStatus;
  protected readonly ankiStateService = inject(AnkiStateService);
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly actionMenuItems = signal<MenuItem[]>([]);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);

  protected prepareAndToggleMenu(event: MouseEvent, menu: Menu, template: AnkiCardTemplate): void {
    const items: MenuItem[] = [];

    items.push({
      label: template.isDefault ? 'Remove Default' : 'Set as Default',
      icon: 'fa-solid fa-star',
      command: () => this.toggleDefault(template)
    });

    items.push({
      label: 'Edit template',
      icon: 'fa-solid fa-pencil',
      command: () => this.onEditTemplate(template)
    });

    items.push({
      label: 'Delete template',
      icon: 'fa-solid fa-trash',
      styleClass: 'text-red-500',
      command: () => this.onDeleteTemplate(template.id)
    });

    items.push({separator: true});

    if (template.dailyGoal) {
      items.push({
        label: 'Edit daily goal',
        icon: 'fa-solid fa-bullseye',
        command: () => this.onEditDailyGoal(template)
      });
      items.push({
        label: template.dailyGoal.enabled ? 'Disable daily goal' : 'Enable daily goal',
        icon: template.dailyGoal.enabled ? 'fa-solid fa-pause' : 'fa-solid fa-play',
        command: () => this.toggleDailyGoal(template)
      });
      items.push({
        label: 'Remove daily goal',
        icon: 'fa-solid fa-minus',
        command: () => this.removeDailyGoal(template)
      });
    } else {
      items.push({
        label: 'Set daily goal',
        icon: 'fa-solid fa-bullseye',
        command: () => this.onEditDailyGoal(template)
      });
    }

    this.actionMenuItems.set(items);
    menu.toggle(event);
  }

  protected onEditDailyGoal(template: AnkiCardTemplate): void {
    const restoreFocusability = disableFocusInParentDialog();

    const ref = this.dialogService.open(AnkiDailyGoalDialogComponent, {
      header: `Daily Goal for "${template.name}"`,
      width: 'clamp(20rem, 95vw, 30rem)',
      modal: true,
      closeOnEscape: false,
      data: {goal: template.dailyGoal}
    });

    ref.onClose.subscribe((goalData: any) => {
      scheduleRestoreFocus(restoreFocusability);

      if (goalData) {
        const updatedGoal = {
          ...goalData,
          enabled: template.dailyGoal?.enabled ?? true
        };
        this.ankiStateService.updateAnkiCardTemplate(template.id, {...template, dailyGoal: updatedGoal});
        this.ankiStateService.syncDailyGoalNotificationState(template.id, updatedGoal.targetCount, updatedGoal.enabled);
        this.toastService.success('Daily goal updated');
      }
    });
  }

  protected toggleDailyGoal(template: AnkiCardTemplate): void {
    if (!template.dailyGoal) {
      return;
    }
    const updatedGoal = {...template.dailyGoal, enabled: !template.dailyGoal.enabled};
    this.ankiStateService.updateAnkiCardTemplate(template.id, {...template, dailyGoal: updatedGoal});
    this.ankiStateService.syncDailyGoalNotificationState(template.id, updatedGoal.targetCount, updatedGoal.enabled);
  }

  protected removeDailyGoal(template: AnkiCardTemplate): void {
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Remove Daily Goal',
      message: `Are you sure you want to remove the daily goal for "${template.name}"?`,
      accept: () => {
        const {dailyGoal, ...rest} = template;
        this.ankiStateService.updateAnkiCardTemplate(template.id, rest);
        this.toastService.success('Daily goal removed.');
      }
    });
  }

  protected getTodayExports(templateId: string): number {
    const today = this.ankiStateService.getTodayDateString();
    return this.ankiStateService.progressTracker()[today]?.[templateId]?.count || 0;
  }

  protected onAddNewTemplate(): void {
    const restoreFocusability = disableFocusInParentDialog();

    const ref = this.dialogService.open(AnkiTemplateFormDialogComponent, {
      header: 'Add New Anki Template',
      width: 'clamp(20rem, 95vw, 40rem)',
      closeOnEscape: false,
      modal: true
    });

    ref.onClose.subscribe((templateData: AnkiCardTemplate) => {
      scheduleRestoreFocus(restoreFocusability);

      if (templateData) {
        this.ankiStateService.addAnkiCardTemplate({...templateData, id: uuidv4()});
        this.toastService.success('Template added successfully');
      }
    });
  }

  protected onSuspendByDefaultChange(value: boolean): void {
    this.globalSettingsStateService.setAnkiSuspendNewCardsByDefault(value);
  }

  private toggleDefault(template: AnkiCardTemplate): void {
    this.ankiStateService.updateAnkiCardTemplate(template.id, {
      ...template,
      isDefault: !Boolean(template.isDefault)
    });
  }

  private onEditTemplate(template: AnkiCardTemplate): void {
    const restoreFocusability = disableFocusInParentDialog();

    const ref = this.dialogService.open(AnkiTemplateFormDialogComponent, {
      header: `Edit "${template.name}"`,
      width: 'clamp(20rem, 95vw, 40rem)',
      modal: true,
      closeOnEscape: false,
      data: {template}
    });

    ref.onClose.subscribe((templateData: AnkiCardTemplate) => {
      scheduleRestoreFocus(restoreFocusability);

      if (templateData) {
        const updatedTemplate = {...templateData, dailyGoal: template.dailyGoal};
        this.ankiStateService.updateAnkiCardTemplate(template.id, updatedTemplate);
        this.toastService.success('Template updated successfully');
      }
    });
  }

  private onDeleteTemplate(id: string): void {
    this.confirmationService.confirm({
      ...DEFAULT_CONFIRMATION,
      header: 'Confirm deletion',
      message: `Are you sure you want to delete this template?<br>This action cannot be undone.`,
      accept: () => {
        this.ankiStateService.deleteCardTemplate(id);
        this.toastService.success('Template deleted');
      }
    });
  }
}
