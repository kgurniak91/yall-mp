import {createComponentFactory, Spectator} from '@ngneat/spectator';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {DictionaryLanguageDialogComponent} from './dictionary-language-dialog.component';
import {DictionaryLanguageDialogData} from './dictionary-language-dialog.types';

describe('DictionaryLanguageDialogComponent', () => {
  const data: DictionaryLanguageDialogData = {
    dictionaries: ['old-en-zh', 'old-jmdict'],
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

  it('lists every dictionary without a language and warns that the choice is final', () => {
    const titles = spectator.queryAll('.dictionary-title').map(el => el.textContent?.trim());
    expect(titles).toEqual(['old-en-zh', 'old-jmdict']);
    expect(spectator.query('.dictionary-language-warning')?.textContent).toContain('cannot be changed later');
    expect(spectator.query('.dictionary-language-warning')?.textContent).toContain('import it again');
  });

  it('enables Save only once a language is chosen', () => {
    expect(saveButton().disabled).toBeTrue();
    choose('old-en-zh', 'en');
    expect(saveButton().disabled).toBeFalse();
    choose('old-en-zh', null);
    expect(saveButton().disabled).toBeTrue();
  });

  it('saves only the dictionaries that got a language', () => {
    choose('old-en-zh', 'en');
    spectator.click(saveButton());
    expect(close).toHaveBeenCalledOnceWith({'old-en-zh': 'en'});
  });

  it('"Ask me later" closes without an answer', () => {
    choose('old-jmdict', 'ja');
    const later = spectator.queryAll('p-button button').find(b => b.textContent?.includes('Ask me later')) as HTMLButtonElement;
    spectator.click(later);
    expect(close).toHaveBeenCalledOnceWith();
  });
});
