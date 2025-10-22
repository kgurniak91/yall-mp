import {Component, inject, signal} from '@angular/core';
import {Fieldset} from 'primeng/fieldset';
import {RadioButton} from 'primeng/radiobutton';
import {FormsModule} from '@angular/forms';
import {TableModule} from 'primeng/table';
import {Button} from 'primeng/button';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {SubtitleLookupBrowserType, SubtitleLookupService} from '../../../model/settings.types';
import {v4 as uuidv4} from 'uuid';
import {Message} from 'primeng/message';
import {ConfirmationService, MenuItem} from 'primeng/api';
import {Menu} from 'primeng/menu';
import {DialogService} from 'primeng/dynamicdialog';
import {EditLookupServiceDialogComponent} from './edit-lookup-service-dialog/edit-lookup-service-dialog.component';
import {EditLookupServiceDialogTypes} from './edit-lookup-service-dialog/edit-lookup-service-dialog.types';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {ToastService} from '../../../shared/services/toast/toast.service';

@Component({
  selector: 'app-subtitles-lookup-settings',
  imports: [
    FormsModule,
    Fieldset,
    RadioButton,
    TableModule,
    Button,
    Message,
    Menu
  ],
  templateUrl: './subtitles-lookup-settings.component.html',
  styleUrl: './subtitles-lookup-settings.component.scss'
})
export class SubtitlesLookupSettingsComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly SubtitleLookupBrowserType = SubtitleLookupBrowserType;
  protected actionMenuItems = signal<MenuItem[]>([]);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);

  getDisplayBrowserType(service: SubtitleLookupService): string {
    const serviceOverride = service.browserType;

    if (serviceOverride === SubtitleLookupBrowserType.System) {
      return 'System Browser';
    }

    if (serviceOverride === SubtitleLookupBrowserType.BuiltIn) {
      return 'Built-in Browser';
    }

    const globalDefault = this.globalSettingsStateService.subtitleLookupBrowserType();
    const defaultLabel = globalDefault === SubtitleLookupBrowserType.System ? 'System' : 'Built-in';
    return `Default (${defaultLabel})`;
  }

  onActionsMenuShow(service: SubtitleLookupService): void {
    const services = this.globalSettingsStateService.subtitleLookupServices();
    const index = services.findIndex(s => s.id === service.id);
    const count = services.length;

    const menuItems: MenuItem[] = [];
    const moveActions: MenuItem[] = [];

    // Conditionally add "Move" actions
    if (count > 1) {
      if (index > 0) { // Can't move up if it's the first item
        moveActions.push({
          label: 'Move Up',
          icon: 'fa-solid fa-arrow-up',
          command: () => this.onMoveService(service, 'up')
        });
      }
      if (index < count - 1) { // Can't move down if it's the last item
        moveActions.push({
          label: 'Move Down',
          icon: 'fa-solid fa-arrow-down',
          command: () => this.onMoveService(service, 'down')
        });
      }
    }

    if (moveActions.length > 0) {
      menuItems.push(...moveActions);
    }

    // Conditionally add "Set as Default" action
    if (!service.isDefault) {
      // Add a separator if there were move actions before this
      if (menuItems.length > 0) {
        menuItems.push({separator: true});
      }
      menuItems.push({
        label: 'Set as Default',
        icon: 'fa-solid fa-star',
        command: () => this.onSetAsDefault(service)
      });
    }

    // Always add "Edit" and "Delete", with a separator if needed
    if (menuItems.length > 0) {
      menuItems.push({separator: true});
    }

    menuItems.push(
      {
        label: 'Edit',
        icon: 'fa-solid fa-pencil',
        command: () => this.onEditService(service)
      },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'p-menuitem-danger',
        command: () => this.onDeleteService(service)
      }
    );

    this.actionMenuItems.set(menuItems);
  }

  onMoveService(service: SubtitleLookupService, direction: 'up' | 'down'): void {
    const services = [...this.globalSettingsStateService.subtitleLookupServices()];
    const index = services.findIndex(s => s.id === service.id);

    if (direction === 'up' && index > 0) {
      // Swap with the element above
      [services[index - 1], services[index]] = [services[index], services[index - 1]];
    } else if (direction === 'down' && index < services.length - 1) {
      // Swap with the element below
      [services[index + 1], services[index]] = [services[index], services[index + 1]];
    }

    this.globalSettingsStateService.updateSubtitleLookupServices(services);
  }

  onBrowserSettingChange(newBrowserType: SubtitleLookupBrowserType): void {
    this.globalSettingsStateService.setSubtitleLookupBrowserType(newBrowserType);
  }

  onAddNewService(): void {
    const newService: Partial<SubtitleLookupService> = {
      id: uuidv4(),
      name: '',
      urlTemplate: '',
      isDefault: false,
      browserType: null
    };
    this.openEditDialog(newService, 'Add New Lookup Service');
  }

  onEditService(service: SubtitleLookupService): void {
    this.openEditDialog(service, 'Edit Lookup Service');
  }

  onDeleteService(serviceToDelete: SubtitleLookupService): void {
    this.confirmationService.confirm({
      header: 'Confirm deletion',
      message: `Are you sure you want to delete the lookup service <b>${serviceToDelete.name}</b>?<br>This action cannot be undone.`,
      icon: 'fa-solid fa-circle-exclamation',
      accept: () => {
        let services = this.globalSettingsStateService.subtitleLookupServices();
        const newServices = services.filter(s => s.id !== serviceToDelete.id);

        // If the deleted service was the default, and there are other services left, make the first one the new default:
        if (serviceToDelete.isDefault && newServices.length > 0) {
          newServices[0].isDefault = true;
        }

        this.globalSettingsStateService.updateSubtitleLookupServices(newServices);
        this.toastService.success('Lookup service deleted');
      }
    });
  }

  onSetAsDefault(serviceToMakeDefault: SubtitleLookupService): void {
    let services = this.globalSettingsStateService.subtitleLookupServices();
    const newServices = services.map(s => ({
      ...s,
      isDefault: s.id === serviceToMakeDefault.id
    }));
    this.globalSettingsStateService.updateSubtitleLookupServices(newServices);
  }

  private openEditDialog(subtitleLookupService: Partial<SubtitleLookupService>, header: string): void {
    const restoreFocusability = disableFocusInParentDialog();

    const data: EditLookupServiceDialogTypes = {
      subtitleLookupService
    };

    const dialogRef = this.dialogService.open(EditLookupServiceDialogComponent, {
      header,
      modal: true,
      width: 'clamp(30rem, 95vw, 45rem)',
      closeOnEscape: false,
      data
    });

    dialogRef.onClose.subscribe((savedService: SubtitleLookupService | undefined) => {
      scheduleRestoreFocus(restoreFocusability);

      if (savedService) {
        this.saveLookupService(savedService);
      }
    });
  }

  private saveLookupService(serviceToSave: SubtitleLookupService): void {
    let lookupServices = this.globalSettingsStateService.subtitleLookupServices();
    let newServices: SubtitleLookupService[];

    // Check if it's an existing service or a new one
    if (lookupServices.some(s => s.id === serviceToSave.id)) { // Edit mode
      newServices = lookupServices.map(s => s.id === serviceToSave.id ? serviceToSave : s);
    } else { // Add mode
      newServices = [...lookupServices, serviceToSave];
      if (newServices.length === 1) {
        newServices[0].isDefault = true;
      }
    }

    this.globalSettingsStateService.updateSubtitleLookupServices(newServices);
  }
}
