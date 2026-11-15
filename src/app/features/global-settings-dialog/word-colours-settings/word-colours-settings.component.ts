import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Fieldset} from 'primeng/fieldset';
import {InputSwitch} from 'primeng/inputswitch';
import {ColorPicker} from 'primeng/colorpicker';
import {SelectButton} from 'primeng/selectbutton';
import {InputText} from 'primeng/inputtext';
import {Button} from 'primeng/button';
import {MultiSelect} from 'primeng/multiselect';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {DEFAULT_WORD_COLOURING, WordColouringSettings} from '../../../model/settings.types';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';
import {primaryModifierLabel} from '../../../core/services/keyboard-shortcuts-helper/primary-modifier';

type GenderKey = keyof WordColouringSettings['colors'];
type TagKey = keyof WordColouringSettings['tags'];

/** "#FFAA00", "ffaa00", "#ABC" (short form) -> "#ffaa00" / "#aabbcc"; anything else -> null. */
export function parseHexColour(text: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((text ?? '').trim());
  if (!m) {
    return null;
  }
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/** One piece of the preview: plain text, or a word with its gender ('mf' = a noun with both genders). */
interface PreviewWord {
  text: string;
  gender?: 'm' | 'f' | 'n' | 'mf';
  article?: boolean;
}

export interface PreviewPiece {
  text: string;
  color: string | null;
  dotted: boolean;
}

const PREVIEW_LINES: PreviewWord[][] = [
  [
    {text: 'Meine', gender: 'f', article: true}, {text: ' '}, {text: 'Weisheit', gender: 'f'},
    {text: ' ist sowohl '}, {text: 'ein', gender: 'm', article: true}, {text: ' '}, {text: 'Segen', gender: 'm'},
    {text: ' als auch '}, {text: 'ein', gender: 'n', article: true}, {text: ' '}, {text: 'Pferd', gender: 'n'}, {text: '.'}
  ],
  [
    {text: 'Je parle avec '}, {text: 'l\'', gender: 'mf', article: true}, {text: 'artiste', gender: 'mf'}, {text: '.'}
  ]
];

@Component({
  selector: 'app-word-colours-settings',
  imports: [FormsModule, Fieldset, InputSwitch, ColorPicker, SelectButton, InputText, Button, MultiSelect],
  templateUrl: './word-colours-settings.component.html',
  styleUrl: './word-colours-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WordColoursSettingsComponent {
  protected readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  protected readonly settings = this.globalSettingsStateService.wordColouring;
  protected readonly ctrl = primaryModifierLabel();
  private readonly yomitanService = inject(YomitanService);

  /**
   * Yomitan's languages, labelled as in the project settings; a listed code Yomitan does not know (or before its
   * languages have loaded) still shows, by its code, so it can be removed.
   */
  protected readonly languageOptions = computed(() => {
    const known = this.yomitanService.supportedLanguages().map(l => ({label: `${l.name} (${l.iso})`, value: l.iso}));
    const unknown = this.settings().languages
      .filter(iso => !known.some(o => o.value === iso))
      .map(iso => ({label: iso, value: iso}));
    return [...known, ...unknown];
  });

  protected readonly languagesAreDefault = computed(() =>
    JSON.stringify([...this.settings().languages].sort()) === JSON.stringify([...DEFAULT_WORD_COLOURING.languages].sort()));

  protected readonly genders: Array<{ key: GenderKey; label: string; examples: string }> = [
    {key: 'masculine', label: 'Masculine', examples: 'der, le, el, il'},
    {key: 'feminine', label: 'Feminine', examples: 'die, la, a'},
    {key: 'neuter', label: 'Neuter', examples: 'das'}
  ];

  protected readonly tagFields: Array<{ key: TagKey; label: string }> = [
    {key: 'masculine', label: 'Masculine'},
    {key: 'feminine', label: 'Feminine'},
    {key: 'neuter', label: 'Neuter'},
    {key: 'noun', label: 'Noun (part of speech)'}
  ];

  protected readonly ambiguousOptions = [
    {label: 'Dotted underline', value: 'mark'},
    {label: 'First gender', value: 'first'},
    {label: 'No colour', value: 'skip'}
  ];

  /** Hex fields being typed into that do not hold a valid colour yet. */
  protected readonly invalidHex = signal<Partial<Record<GenderKey, boolean>>>({});

  protected readonly coloursAreDefault = computed(() =>
    JSON.stringify(this.settings().colors) === JSON.stringify(DEFAULT_WORD_COLOURING.colors));
  protected readonly tagsAreDefault = computed(() =>
    JSON.stringify(this.settings().tags) === JSON.stringify(DEFAULT_WORD_COLOURING.tags));

  /** The sample lines as the subtitles would show them with the current settings. */
  protected readonly preview = computed<PreviewPiece[][]>(() => {
    const s = this.settings();
    const colourOf = {m: s.colors.masculine, f: s.colors.feminine, n: s.colors.neuter};
    return PREVIEW_LINES.map(line => line.map(word => {
      const plain = {text: word.text, color: null, dotted: false};
      if (!s.enabled || !word.gender || (word.article && !s.articles)) {
        return plain;
      }
      if (word.gender !== 'mf') {
        return {text: word.text, color: colourOf[word.gender], dotted: false};
      }
      // A noun with both genders: marked, coloured as masculine, or left plain; its article only takes a colour
      if (s.ambiguous === 'first') {
        return {text: word.text, color: colourOf.m, dotted: false};
      }
      return s.ambiguous === 'mark' && !word.article ? {text: word.text, color: null, dotted: true} : plain;
    }));
  });

  protected setEnabled(enabled: boolean): void {
    this.globalSettingsStateService.setWordColouring({enabled});
  }

  protected setLanguages(languages: string[] | null): void {
    this.globalSettingsStateService.setWordColouring({languages: languages ?? []});
  }

  protected resetLanguages(): void {
    this.globalSettingsStateService.setWordColouring({languages: [...DEFAULT_WORD_COLOURING.languages]});
  }

  protected setArticles(articles: boolean): void {
    this.globalSettingsStateService.setWordColouring({articles});
  }

  protected setAmbiguous(ambiguous: WordColouringSettings['ambiguous']): void {
    if (ambiguous) {
      this.globalSettingsStateService.setWordColouring({ambiguous});
    }
  }

  /** From the colour picker (hex without '#') or the hex field ("#FFAA00", "#ABC"); invalid text is not saved. */
  protected setColour(key: GenderKey, value: string | null): void {
    const hex = parseHexColour(value);
    this.invalidHex.update(v => ({...v, [key]: hex === null}));
    if (hex && hex !== this.settings().colors[key]) {
      this.globalSettingsStateService.setWordColouring({colors: {...this.settings().colors, [key]: hex}});
    }
  }

  /**
   * Typing in a hex field: a full #RRGGBB is applied at once; a short #RGB waits for Enter or leaving the field (it
   * could still be the start of a longer code), anything else is marked invalid.
   */
  protected hexTyped(key: GenderKey, text: string): void {
    const clean = text.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(clean)) {
      this.setColour(key, clean);
    } else {
      this.invalidHex.update(v => ({...v, [key]: !/^[0-9a-f]{0,5}$/i.test(clean)}));
    }
  }

  /** Enter or leaving the field: apply what is there (short form too), or show the saved colour again. */
  protected hexCommitted(key: GenderKey, input: HTMLInputElement): void {
    const hex = parseHexColour(input.value);
    if (hex) {
      this.setColour(key, hex);
    }
    input.value = this.settings().colors[key];
    this.invalidHex.update(v => ({...v, [key]: false}));
  }

  protected resetColours(): void {
    this.invalidHex.set({});
    this.globalSettingsStateService.setWordColouring({colors: {...DEFAULT_WORD_COLOURING.colors}});
  }

  protected tagText(key: TagKey): string {
    return this.settings().tags[key].join(', ');
  }

  /** Comma or space separated; an empty field goes back to the default names. */
  protected setTags(key: TagKey, text: string): void {
    const names = text.split(/[,\s]+/).map(n => n.trim()).filter(n => n.length > 0);
    this.globalSettingsStateService.setWordColouring({tags: {...this.settings().tags, [key]: names}});
  }

  protected resetTags(): void {
    this.globalSettingsStateService.setWordColouring({
      tags: {
        masculine: [...DEFAULT_WORD_COLOURING.tags.masculine],
        feminine: [...DEFAULT_WORD_COLOURING.tags.feminine],
        neuter: [...DEFAULT_WORD_COLOURING.tags.neuter],
        noun: [...DEFAULT_WORD_COLOURING.tags.noun]
      }
    });
  }
}
