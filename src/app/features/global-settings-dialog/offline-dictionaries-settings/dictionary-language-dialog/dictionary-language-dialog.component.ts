import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {Message} from 'primeng/message';
import {SelectModule} from 'primeng/select';
import {FormsModule} from '@angular/forms';
import {DictionaryLanguageDialogData, DictionaryLanguageDialogResult} from './dictionary-language-dialog.types';

/** Asks which language old-format dictionaries (ones without language information) are for; also edits earlier answers. */
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
  private readonly initial: Record<string, string | null> = Object.fromEntries(
    this.data.dictionaries.map(d => [d.title, d.language])
  );
  protected readonly choices = signal<Record<string, string | null>>({...this.initial});
  private readonly changes = computed(() => {
    const result: DictionaryLanguageDialogResult = {};
    for (const [title, iso] of Object.entries(this.choices())) {
      if (iso && iso !== this.initial[title]) {
        result[title] = iso;
      }
    }
    return result;
  });
  protected readonly hasChanges = computed(() => Object.keys(this.changes()).length > 0);

  protected setChoice(title: string, iso: string | null) {
    this.choices.update(choices => ({...choices, [title]: iso}));
  }

  protected onSave() {
    this.ref.close(this.changes());
  }

  protected onLater() {
    this.ref.close();
  }
}
