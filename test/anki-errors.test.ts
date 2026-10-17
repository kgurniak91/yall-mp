import {describe, expect, it} from 'vitest';
import {
  ANKI_UNREACHABLE_MESSAGE,
  clozeFieldNames,
  containsCloze,
  explainAddNoteError,
  toToastHtml
} from '../shared/utils/anki-errors';

const base = {
  templateName: 'French',
  deckName: 'Tikvah::French',
  modelName: '0Migaku',
  fields: {Sentence: 'Mais vous n\'avez pas de famille.', 'Sentence Audio': '[sound:a.mp3]'},
};

const clozeTemplates = {
  Cloze: {Front: '<div>{{type:cloze:Sentence}}</div>{{Sentence Audio}}', Back: '{{cloze:Sentence}}<br>{{Translation}}'}
};

describe('anki-errors', () => {
  it('finds cloze fields in card templates, with or without filters', () => {
    expect(clozeFieldNames(clozeTemplates)).toEqual(['Sentence']);
    expect(clozeFieldNames({Card: {Front: '{{cloze:Text}}', Back: '{{furigana:cloze:Extra}}'}})).toEqual(['Text', 'Extra']);
    expect(clozeFieldNames({Card: {Front: '{{Front}}', Back: '{{FrontSide}}<hr>{{Back}}'}})).toEqual([]);
    expect(clozeFieldNames(null)).toEqual([]);
  });

  it('recognises cloze deletions', () => {
    expect(containsCloze('practi{{c1::cal}}ly')).toBe(true);
    expect(containsCloze('{{c12::x::hint}}')).toBe(true);
    expect(containsCloze('no cloze here')).toBe(false);
    expect(containsCloze('{{Sentence}}')).toBe(false);
  });

  it('explains "unknown reason" on a cloze note type whose text has no cloze', () => {
    const text = explainAddNoteError('cannot create note for unknown reason', {...base, cardTemplates: clozeTemplates});
    expect(text).toContain('cloze note type');
    expect(text).toContain('"Sentence"');
    expect(text).toContain('{{c1::…}}');
    expect(text).toContain('Export template "French" (deck "Tikvah::French", note type "0Migaku")');
    expect(text.split('\n').pop()).toBe('Anki said: "cannot create note for unknown reason"');
  });

  it('says when the export template does not fill the cloze field at all', () => {
    const text = explainAddNoteError('cannot create note for unknown reason', {
      ...base, fields: {'Sentence Audio': '[sound:a.mp3]'}, cardTemplates: clozeTemplates
    });
    expect(text).toContain('does not fill "Sentence"');
  });

  it('does not blame clozes when the cloze field already has one', () => {
    const text = explainAddNoteError('cannot create note for unknown reason', {
      ...base, fields: {Sentence: 'a {{c1::b}}'}, cardTemplates: clozeTemplates
    });
    expect(text).not.toContain('cloze note type');
    expect(text).toContain('without naming a reason');
  });

  it('names empty front fields on a non-cloze note type', () => {
    const text = explainAddNoteError('cannot create note for unknown reason', {
      ...base, modelName: 'Basic', fields: {Back: 'x'},
      cardTemplates: {'Card 1': {Front: '{{Front}}', Back: '{{FrontSide}}<hr>{{Back}}'}}
    });
    expect(text).toContain('"Front"');
    expect(text).toContain('leaves empty');
  });

  it('works without template information', () => {
    const text = explainAddNoteError('cannot create note for unknown reason', {...base, cardTemplates: null});
    expect(text).toContain('Manage Note Types');
  });

  it('names the empty first field', () => {
    const text = explainAddNoteError('cannot create note because it is empty', {...base, modelFieldNames: ['Sentence', 'Translation']});
    expect(text).toContain('"Sentence", would be empty');
  });

  it('explains missing note types and decks', () => {
    expect(explainAddNoteError('model was not found: 0Migaku', base)).toContain('no note type called "0Migaku"');
    expect(explainAddNoteError('deck was not found: Tikvah::French', base)).toContain('no deck called "Tikvah::French"');
  });

  it('passes the unreachable message through without the "Anki said" line', () => {
    expect(explainAddNoteError(ANKI_UNREACHABLE_MESSAGE, base)).toBe(ANKI_UNREACHABLE_MESSAGE);
  });

  it('keeps unknown messages', () => {
    const text = explainAddNoteError('something new', base);
    expect(text).toContain('Anki refused the note.');
    expect(text).toContain('Anki said: "something new"');
  });

  it('escapes HTML for the toast and keeps line breaks', () => {
    expect(toToastHtml('a <b> & "c"\nd')).toBe('a &lt;b&gt; &amp; &quot;c&quot;<br>d');
  });
});
