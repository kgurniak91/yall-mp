import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {Message} from 'primeng/message';
import {SelectModule} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {DictionaryLanguageDialogData, DictionaryLanguageDialogResult} from './dictionary-language-dialog.types';

/** Asks which language an old-format dictionary (one without language information) is for. */
@Component({
  selector: 'app-dictionary-language-dialog',
  imports: [
    Button,
    Message,
    SelectModule,
    FormsModule
  ],
  templateUrl: './dictionary-language-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DictionaryLanguageDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<DictionaryLanguageDialogData>>(DynamicDialogConfig);
  protected readonly data = this.config.data!;
  protected readonly choices = signal<Record<string, string | null>>(
    Object.fromEntries(this.data.dictionaries.map(title => [title, null]))
  );
  protected readonly hasChoice = computed(() => Object.values(this.choices()).some(iso => !!iso));

  protected setChoice(title: string, iso: string | null) {
    this.choices.update(choices => ({...choices, [title]: iso}));
  }

  protected onSave() {
    const result: DictionaryLanguageDialogResult = {};
    for (const [title, iso] of Object.entries(this.choices())) {
      if (iso) {
        result[title] = iso;
      }
    }
    this.ref.close(result);
  }

  protected onLater() {
    this.ref.close();
  }
}
