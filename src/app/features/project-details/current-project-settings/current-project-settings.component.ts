import {Component, computed, inject, input, output} from '@angular/core';
import {BuiltInSettingsPreset, ProjectSettings, SettingsPreset} from '../../../model/settings.types';
import {Fieldset} from 'primeng/fieldset';
import {Select} from 'primeng/select';
import {
  CommonProjectSettingsComponent
} from '../../../shared/components/common-project-settings/common-project-settings.component';
import {FormsModule} from '@angular/forms';
import {InputNumber} from "primeng/inputnumber";
import {Button} from "primeng/button";
import {Tooltip} from "primeng/tooltip";
import {RadioButton} from 'primeng/radiobutton';
import {Divider} from 'primeng/divider';
import {SupportedLanguage} from '../../../model/project.types';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {Message} from 'primeng/message';
import {DialogOrchestrationService} from '../../../core/services/dialog-orchestration/dialog-orchestration.service';
import {GlobalSettingsTab} from '../../global-settings-dialog/global-settings-dialog.types';
import {TagsInputComponent} from '../../../shared/components/tags-input/tags-input.component';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';

@Component({
  selector: 'app-current-project-settings',
  imports: [
    Fieldset,
    Select,
    CommonProjectSettingsComponent,
    FormsModule,
    InputNumber,
    Button,
    Tooltip,
    RadioButton,
    Divider,
    Message,
    TagsInputComponent
  ],
  templateUrl: './current-project-settings.component.html',
  styleUrl: './current-project-settings.component.scss'
})
export class CurrentProjectSettingsComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly settingsPresets = input.required<SettingsPreset[]>();
  public readonly isAssProject = input(false);
  public readonly selectedSettingsPreset = input.required<SettingsPreset | null>();
  public readonly detectedLanguage = input<SupportedLanguage>();
  public readonly ankiTags = input<string[]>();
  public readonly ankiTagsChange = output<string[]>();
  public readonly settingsChange = output<ProjectSettings>();
  public readonly selectedSettingsPresetChange = output<SettingsPreset | null>();
  protected readonly BuiltInSettingsPreset = BuiltInSettingsPreset;
  protected readonly subtitlesLanguageOptions = computed(() => {
    const fromYomitan = this.yomitanService.supportedLanguages().map(l => ({
      label: `${l.name} (${l.iso})`,
      value: l.iso
    }));

    return [
      ...fromYomitan,
      {label: 'Other', value: 'other'}
    ];
  });
  protected readonly lookupServiceOptions = computed(() => {
    const globalServices = this.globalSettingsStateService.subtitleLookupServices();
    const options: { name: string, id: string | null }[] = [...globalServices];
    const defaultService = globalServices.find(s => s.isDefault);

    if (defaultService) {
      options.unshift({name: `Default (${defaultService.name})`, id: null});
    }

    return options;
  });
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly yomitanService = inject(YomitanService);

  protected openGlobalSettings(event: MouseEvent): void {
    event.preventDefault();
    this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.ProjectDefaults);
  }

  protected openOfflineDictSettings(event: MouseEvent): void {
    event.preventDefault();
    this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.OfflineDictionaries);
  }

  protected onSettingsPresetChange(preset: SettingsPreset | null): void {
    this.selectedSettingsPresetChange.emit(preset);
  }

  protected onSettingChange<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]): void {
    this.settingsChange.emit({
      ...this.settings(),
      [key]: value
    });
  }
}
