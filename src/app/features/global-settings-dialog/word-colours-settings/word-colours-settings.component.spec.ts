import {createComponentFactory, Spectator} from '@ngneat/spectator';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {computed, signal} from '@angular/core';
import {parseHexColour, PreviewPiece, WordColoursSettingsComponent} from './word-colours-settings.component';
import {GlobalSettingsStateService} from '../../../state/global-settings/global-settings-state.service';
import {DEFAULT_WORD_COLOURING, normaliseWordColouring, WordColouringSettings} from '../../../model/settings.types';
import {YomitanService} from '../../../core/services/yomitan/yomitan.service';

describe('parseHexColour', () => {
  it('accepts #RRGGBB and #RGB, with or without #, any case, and stores the long lowercase form', () => {
    expect(parseHexColour('#FFAA00')).toBe('#ffaa00');
    expect(parseHexColour('ffaa00')).toBe('#ffaa00');
    expect(parseHexColour('#ABC')).toBe('#aabbcc');
    expect(parseHexColour(' #fa0 ')).toBe('#ffaa00');
  });

  it('rejects anything else', () => {
    for (const bad of ['', '#', '#AB', '#ABCD', '#GGGGGG', 'red', '#FFAA001', null, undefined]) {
      expect(parseHexColour(bad as any)).withContext(String(bad)).toBeNull();
    }
  });
});

describe('WordColoursSettingsComponent', () => {
  const stored = signal<WordColouringSettings>(normaliseWordColouring(undefined));
  const languages = signal([
    {iso: 'cs', name: 'Czech'}, {iso: 'de', name: 'German'}, {iso: 'en', name: 'English'}, {iso: 'es', name: 'Spanish'},
    {iso: 'fr', name: 'French'}, {iso: 'it', name: 'Italian'}, {iso: 'pl', name: 'Polish'}, {iso: 'pt', name: 'Portuguese'},
    {iso: 'ru', name: 'Russian'}
  ]);
  const fakeState = {
    wordColouring: computed(() => stored()),
    setWordColouring: (changes: Partial<WordColouringSettings>) => stored.set(normaliseWordColouring({...stored(), ...changes}))
  };

  const createComponent = createComponentFactory({
    component: WordColoursSettingsComponent,
    imports: [NoopAnimationsModule],
    providers: [
      {provide: GlobalSettingsStateService, useValue: fakeState},
      {provide: YomitanService, useValue: {supportedLanguages: languages}}
    ]
  });

  let spectator: Spectator<WordColoursSettingsComponent>;
  const input = (id: string) => spectator.query(`#${id}`) as HTMLInputElement;
  const typeInto = (id: string, value: string, event: 'input' | 'change' | 'blur') => {
    const el = input(id);
    el.value = value;
    el.dispatchEvent(new Event(event));
    spectator.detectChanges();
  };
  const preview = (): PreviewPiece[][] => (spectator.component as any).preview();
  const word = (text: string, line = 0) => preview()[line].find(p => p.text === text)!;
  const button = (label: string) => spectator.queryAll('p-button button').find(b => b.textContent?.includes(label)) as HTMLButtonElement;

  beforeEach(() => {
    stored.set(normaliseWordColouring(undefined));
    spectator = createComponent();
  });

  it('shows the default tag names of the wty and kty dictionaries', () => {
    expect(input('word-tags-masculine').value).toBe('masc');
    expect(input('word-tags-feminine').value).toBe('fem');
    expect(input('word-tags-neuter').value).toBe('neut');
    expect(input('word-tags-noun').value).toBe('n');
  });

  it('saves tag names typed with commas or spaces; an emptied field goes back to the default', () => {
    typeInto('word-tags-masculine', 'm, masc  male', 'change');
    expect(stored().tags.masculine).toEqual(['m', 'masc', 'male']);
    typeInto('word-tags-masculine', '   ', 'change');
    expect(stored().tags.masculine).toEqual(['masc']);
  });

  it('a full hex code typed into the field is applied at once', () => {
    typeInto('word-colour-hex-neuter', '#C2C7D0', 'input');
    expect(stored().colors.neuter).toBe('#c2c7d0');
    expect(input('word-colour-hex-neuter').classList).not.toContain('ng-invalid');
  });

  it('a short hex code is applied on leaving the field (it could still grow into a long one)', () => {
    typeInto('word-colour-hex-masculine', '#FA0', 'input');
    expect(stored().colors.masculine).toBe(DEFAULT_WORD_COLOURING.colors.masculine);
    typeInto('word-colour-hex-masculine', '#FA0', 'blur');
    expect(stored().colors.masculine).toBe('#ffaa00');
    expect(input('word-colour-hex-masculine').value).toBe('#ffaa00');
  });

  it('marks text that cannot become a colour, saves nothing, and shows the saved colour again on leaving', () => {
    typeInto('word-colour-hex-feminine', '#XYZ', 'input');
    expect(input('word-colour-hex-feminine').classList).toContain('ng-invalid');
    typeInto('word-colour-hex-feminine', '#XYZ', 'blur');
    expect(stored().colors.feminine).toBe(DEFAULT_WORD_COLOURING.colors.feminine);
    expect(input('word-colour-hex-feminine').value).toBe(DEFAULT_WORD_COLOURING.colors.feminine);
    expect(input('word-colour-hex-feminine').classList).not.toContain('ng-invalid');
  });

  it('takes the colour picker value (hex without #)', () => {
    (spectator.component as any).setColour('neuter', 'c2c7d0');
    expect(stored().colors.neuter).toBe('#c2c7d0');
  });

  it('is off by default, and the preview shows the line plain', () => {
    expect(stored().enabled).toBeFalse();
    expect(preview().flat().every(p => p.color === null && !p.dotted)).toBeTrue();
  });

  it('the preview follows the colours, the on/off switch and the rules', () => {
    const {masculine, feminine} = DEFAULT_WORD_COLOURING.colors;
    stored.set(normaliseWordColouring({...stored(), enabled: true}));
    expect(word('Weisheit').color).toBe(feminine);
    expect(word('Meine').color).toBe(feminine);
    expect(word('artiste', 1).dotted).toBeTrue();

    stored.set(normaliseWordColouring({...stored(), articles: false}));
    expect(word('Meine').color).toBeNull();
    expect(word('Weisheit').color).toBe(feminine);

    stored.set(normaliseWordColouring({...stored(), articles: true, ambiguous: 'first'}));
    expect(word('artiste', 1)).toEqual({text: 'artiste', color: masculine, dotted: false});
    expect(word('l\'', 1).color).toBe(masculine);

    stored.set(normaliseWordColouring({...stored(), ambiguous: 'skip'}));
    expect(word('artiste', 1)).toEqual({text: 'artiste', color: null, dotted: false});

    stored.set(normaliseWordColouring({...stored(), enabled: false}));
    expect(preview().flat().every(p => p.color === null && !p.dotted)).toBeTrue();
  });

  it('renders the preview with the colours', () => {
    (spectator.component as any).setEnabled(true);
    (spectator.component as any).setColour('neuter', '#c2c7d0');
    spectator.detectChanges();
    const pferd = spectator.queryAll('[data-testid="word-colours-preview"] span').find(s => s.textContent === 'Pferd')!;
    expect(pferd.getAttribute('style')).toContain('rgb(194, 199, 208)');
  });

  it('has outlined reset buttons, enabled only when something differs from the defaults', () => {
    expect(button('Reset colours to default').disabled).toBeTrue();
    expect(button('Reset tags to default').disabled).toBeTrue();
    expect(button('Reset colours to default').classList).toContain('p-button-outlined');

    typeInto('word-colour-hex-neuter', '#c2c7d0', 'input');
    typeInto('word-tags-noun', 'noun', 'change');
    expect(button('Reset colours to default').disabled).toBeFalse();
    spectator.click(button('Reset colours to default'));
    spectator.click(button('Reset tags to default'));
    expect(stored().colors).toEqual(DEFAULT_WORD_COLOURING.colors);
    expect(stored().tags).toEqual(DEFAULT_WORD_COLOURING.tags);
  });

  it('turns the colouring on and off', () => {
    (spectator.component as any).setEnabled(true);
    expect(stored().enabled).toBeTrue();
    (spectator.component as any).setEnabled(false);
    expect(stored().enabled).toBeFalse();
  });

  describe('languages', () => {
    const options = () => (spectator.component as any).languageOptions() as Array<{ label: string; value: string }>;

    it('offers the languages Yomitan knows, labelled as in the project settings, with the tested ones chosen', async () => {
      expect(options().map(o => o.label)).toContain('Czech (cs)');
      expect(stored().languages).toEqual(['de', 'fr', 'es', 'it', 'pt', 'ru', 'pl']);
      // ngModel hands the value to the multiselect asynchronously
      await spectator.fixture.whenStable();
      spectator.detectChanges();
      const chips = spectator.queryAll('[data-testid="word-colouring-languages"] .p-multiselect-chip-item').map(c => c.textContent!.trim());
      expect(chips).toEqual(['German (de)', 'French (fr)', 'Spanish (es)', 'Italian (it)', 'Portuguese (pt)', 'Russian (ru)', 'Polish (pl)']);
    });

    it('adds and removes languages; an emptied list stays empty', () => {
      (spectator.component as any).setLanguages([...stored().languages, 'cs']);
      expect(stored().languages).toContain('cs');
      (spectator.component as any).setLanguages(['de']);
      expect(stored().languages).toEqual(['de']);
      (spectator.component as any).setLanguages(null);
      expect(stored().languages).toEqual([]);
    });

    it('a chosen code Yomitan does not know still shows, by its code', () => {
      stored.set(normaliseWordColouring({...stored(), languages: ['de', 'xx']}));
      expect(options().find(o => o.value === 'xx')?.label).toBe('xx');
      expect(options().filter(o => o.value === 'de').length).toBe(1);
    });

    it('resets to the tested languages', () => {
      expect(button('Reset languages to default').disabled).toBeTrue();
      (spectator.component as any).setLanguages(['de']);
      spectator.detectChanges();
      expect(button('Reset languages to default').disabled).toBeFalse();
      spectator.click(button('Reset languages to default'));
      expect(stored().languages).toEqual(DEFAULT_WORD_COLOURING.languages);
    });
  });

  it('tells which subtitles and dictionaries it works with', () => {
    const intro = spectator.query('.settings-container > p')!.textContent!;
    expect(intro).toContain('wty-');
    expect(intro).toContain('not ASS subtitles');
    expect(intro).toContain('Shift+G');
  });
});
