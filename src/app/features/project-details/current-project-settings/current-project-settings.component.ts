import {ChangeDetectionStrategy, Component, computed, inject, input, output} from '@angular/core';
import {
  BuiltInSettingsPreset,
  BuiltInSettingsPresets,
  ProjectSettings,
  SettingsPreset
} from '../../../model/settings.types';
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
import {RouterLink} from '@angular/router';
import {MediaTrack} from '../../../../../shared/types/media.type';
import {cloneDeep} from 'lodash-es';

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
    TagsInputComponent,
    RouterLink
  ],
  templateUrl: './current-project-settings.component.html',
  styleUrl: './current-project-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurrentProjectSettingsComponent {
  public readonly settings = input.required<ProjectSettings>();
  public readonly isAssProject = input(false);
  public readonly detectedLanguage = input<SupportedLanguage>();
  public readonly ankiTags = input<string[]>();
  public readonly audioTracks = input<MediaTrack[]>([]);
  public readonly projectId = input.required<string>();
  public readonly ankiTagsChange = output<string[]>();
  public readonly settingsChange = output<ProjectSettings>();
  protected readonly BuiltInSettingsPresets = BuiltInSettingsPresets;
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

  protected readonly selectedAudioTrackLabel = computed(() => {
    const selectedIndex = this.settings().selectedAudioTrackIndex;
    const track = this.audioTracks().find(t => t.index === selectedIndex);

    if (track) {
      return track.label || `Track ${track.index}`;
    }
    return `Track ${selectedIndex ?? 'Unknown'}`;
  });

  protected readonly activePreset = computed(() => {
    const currentSettings = this.settings();
    return BuiltInSettingsPresets.find(preset =>
      this.settingsPresetKeys.every(k => currentSettings[k] === preset.settings[k])
    ) || null;
  });

  protected readonly placeholderText = computed(() => {
    if (this.activePreset()) {
      return 'Custom';
    }

    const currentSettings = this.settings();
    const globalDefaults = this.globalSettingsStateService.defaultProjectSettings();
    const isDefault = this.allCommonKeys.every(k => currentSettings[k] === globalDefaults[k]);
    return isDefault ? 'Default' : 'Custom';
  });

  protected readonly canResetToDefault = computed(() => {
    const currentSettings = this.settings();
    const globalDefaults = this.globalSettingsStateService.defaultProjectSettings();
    return !this.allCommonKeys.every(k => currentSettings[k] === globalDefaults[k]);
  });

  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly dialogOrchestrationService = inject(DialogOrchestrationService);
  private readonly yomitanService = inject(YomitanService);
  private readonly settingsPresetKeys: (keyof ProjectSettings)[] = [
    'autoPauseAtStart',
    'autoPauseAtEnd',
    'subtitleBehavior'
  ];
  private readonly allCommonKeys: (keyof ProjectSettings)[] = [
    ...this.settingsPresetKeys,
    'subtitledClipSpeed',
    'gapSpeed',
    'speedOverride'
  ];

  protected openGlobalSettings(event: MouseEvent): void {
    event.preventDefault();
    this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.ProjectDefaults);
  }

  protected openOfflineDictSettings(event: MouseEvent): void {
    event.preventDefault();
    this.dialogOrchestrationService.openGlobalSettingsDialog(GlobalSettingsTab.OfflineDictionaries);
  }

  protected onSettingsPresetChange(preset: SettingsPreset | null): void {
    if (preset) {
      this.settingsChange.emit({
        ...this.settings(),
        ...preset.settings
      });
    }
  }

  protected onResetToDefault(): void {
    const globalDefaults = this.globalSettingsStateService.defaultProjectSettings();
    const currentSettings = this.settings();
    const newSettings = cloneDeep(currentSettings);

    this.allCommonKeys.forEach(key => {
      (newSettings as any)[key] = globalDefaults[key];
    });

    this.settingsChange.emit(newSettings);
  }

  protected onSettingChange<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]): void {
    this.settingsChange.emit({
      ...this.settings(),
      [key]: value
    });
  }
}
