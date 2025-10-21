import {Component, computed, inject, OnInit} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {InputText} from 'primeng/inputtext';
import {Select} from 'primeng/select';
import {SubtitleLookupBrowserType, SubtitleLookupService} from '../../../../model/settings.types';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {EditLookupServiceDialogTypes} from './edit-lookup-service-dialog.types';

@Component({
  selector: 'app-edit-lookup-service-dialog',
  imports: [FormsModule, Button, InputText, Select],
  templateUrl: './edit-lookup-service-dialog.component.html',
  styleUrl: './edit-lookup-service-dialog.component.scss'
})
export class EditLookupServiceDialogComponent implements OnInit {
  protected subtitleLookupService!: Partial<SubtitleLookupService>;
  protected browserTypeOptions = computed(() => {
    const globalDefault = this.globalSettingsStateService.subtitleLookupBrowserType();
    const defaultLabel = (globalDefault === SubtitleLookupBrowserType.System) ? 'System' : 'Built-in';

    return [
      {label: `Default (${defaultLabel})`, value: null},
      {label: 'Built-in Browser', value: SubtitleLookupBrowserType.BuiltIn},
      {label: 'System Browser', value: SubtitleLookupBrowserType.System}
    ];
  });
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  ngOnInit(): void {
    const data = this.config.data as EditLookupServiceDialogTypes;
    this.subtitleLookupService = {...data.subtitleLookupService};
  }

  onCancel(): void {
    this.ref.close();
  }

  onSave(): void {
    if (!this.subtitleLookupService || !this.subtitleLookupService.name || !this.subtitleLookupService.urlTemplate) {
      // TODO better validation
      return;
    }
    this.ref.close(this.subtitleLookupService);
  }
}
