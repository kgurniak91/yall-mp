import {createComponentFactory, Spectator} from '@ngneat/spectator';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {DictionaryLanguageDialogComponent} from './dictionary-language-dialog.component';
import {DictionaryLanguageDialogData} from './dictionary-language-dialog.types';

describe('DictionaryLanguageDialogComponent', () => {
  const data: DictionaryLanguageDialogData = {
    dictionaries: [{title: 'old-en-zh', language: null}, {title: 'old-jmdict', language: 'ja'}],
    languages: [{name: 'English (en)', iso: 'en'}, {name: 'Japanese (ja)', iso: 'ja'}]
  };
  let close: jasmine.Spy;

  const createComponent = createComponentFactory({
    component: DictionaryLanguageDialogComponent,
    imports: [NoopAnimationsModule],
    providers: [
      {provide: DynamicDialogConfig, useValue: {data}},
      {provide: DynamicDialogRef, useFactory: () => ({close})}
    ]
  });

  let spectator: Spectator<DictionaryLanguageDialogComponent>;
  const saveButton = () => spectator.query('[data-primary-action] button') as HTMLButtonElement;
  const choose = (title: string, iso: string | null) => {
    (spectator.component as any).setChoice(title, iso);
    spectator.detectChanges();
  };

  beforeEach(() => {
    close = jasmine.createSpy('close');
    spectator = createComponent();
  });

  it('lists the dictionaries without a language, with earlier answers filled in, and says they can be changed', () => {
    const titles = spectator.queryAll('.dictionary-title').map(el => el.textContent?.trim());
    expect(titles).toEqual(['old-en-zh', 'old-jmdict']);
    expect((spectator.component as any).choices()).toEqual({'old-en-zh': null, 'old-jmdict': 'ja'});
    expect(spectator.query('.dictionary-language-note')?.textContent).toContain('change this later');
  });

  it('enables Save only when an answer is given or changed', () => {
    expect(saveButton().disabled).toBeTrue();
    choose('old-en-zh', 'en');
    expect(saveButton().disabled).toBeFalse();
    choose('old-en-zh', null);
    expect(saveButton().disabled).toBeTrue();
    choose('old-jmdict', 'en');
    expect(saveButton().disabled).toBeFalse();
    choose('old-jmdict', 'ja');
    expect(saveButton().disabled).toBeTrue();
  });

  it('saves only the answers that are new or changed', () => {
    choose('old-en-zh', 'en');
    choose('old-jmdict', 'ja');
    spectator.click(saveButton());
    expect(close).toHaveBeenCalledOnceWith({'old-en-zh': 'en'});
  });

  it('"Not now" closes without an answer', () => {
    choose('old-en-zh', 'ja');
    const later = spectator.queryAll('p-button button').find(b => b.textContent?.includes('Not now')) as HTMLButtonElement;
    spectator.click(later);
    expect(close).toHaveBeenCalledOnceWith();
  });
});
