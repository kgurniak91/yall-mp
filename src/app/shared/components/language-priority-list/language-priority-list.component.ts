import {ChangeDetectionStrategy, Component, computed, inject, input, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Button} from 'primeng/button';
import {Select} from 'primeng/select';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';

@Component({
  selector: 'app-language-priority-list',
  standalone: true,
  imports: [FormsModule, Button, Select],
  templateUrl: './language-priority-list.component.html',
  styleUrl: './language-priority-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LanguagePriorityListComponent {
  public readonly value = input.required<string[]>();
  public readonly valueChange = output<string[]>();
  protected readonly selectedToAdd = signal<string | null>(null);
  protected readonly availableOptions = computed(() => {
    const current = new Set(this.value());
    return this.yomitanService.supportedLanguages()
      .filter(l => !current.has(l.iso))
      .map(l => ({label: l.name, value: l.iso}));
  });
  private readonly yomitanService = inject(YomitanService);

  getLanguageName(code: string): string {
    return this.yomitanService.supportedLanguages().find(l => l.iso === code)?.name || code.toUpperCase();
  }

  addLanguage() {
    const code = this.selectedToAdd();
    if (code) {
      this.valueChange.emit([...this.value(), code]);
      this.selectedToAdd.set(null);
    }
  }

  remove(code: string) {
    this.valueChange.emit(this.value().filter(c => c !== code));
  }

  move(index: number, direction: number) {
    const newList = [...this.value()];
    const temp = newList[index];
    newList[index] = newList[index + direction];
    newList[index + direction] = temp;
    this.valueChange.emit(newList);
  }
}
