import {describe, expect, it} from 'vitest';
import {DEFAULT_WORD_COLOURING, normaliseWordColouring, wordColouringActiveFor, wordColouringToggleMessage} from '../src/app/model/settings.types';

describe('normaliseWordColouring', () => {
  it('a settings file from before 0.9.10 gets the defaults', () => {
    expect(normaliseWordColouring(undefined)).toEqual(DEFAULT_WORD_COLOURING);
    expect(normaliseWordColouring(null)).toEqual(DEFAULT_WORD_COLOURING);
  });

  it('is off by default, for the tested languages', () => {
    expect(DEFAULT_WORD_COLOURING.enabled).toBe(false);
    expect(DEFAULT_WORD_COLOURING.languages).toEqual(['de', 'fr', 'es', 'it', 'pt', 'ru', 'pl']);
  });

  it('keeps what the user set and fills in what is missing', () => {
    const result = normaliseWordColouring({enabled: true, colors: {masculine: '#112233'} as any});
    expect(result.enabled).toBe(true);
    expect(result.languages).toEqual(DEFAULT_WORD_COLOURING.languages);
    expect(result.colors).toEqual({masculine: '#112233', feminine: '#ff6b9d', neuter: '#5fd068'});
    expect(result.tags).toEqual(DEFAULT_WORD_COLOURING.tags);
    expect(result.articles).toBe(true);
    expect(result.ambiguous).toBe('mark');
  });

  it('keeps an emptied language list, cleans up the codes', () => {
    expect(normaliseWordColouring({languages: []}).languages).toEqual([]);
    expect(normaliseWordColouring({languages: [' DE ', 'de', '', 'uk']}).languages).toEqual(['de', 'uk']);
    expect(normaliseWordColouring({languages: 'de' as any}).languages).toEqual(DEFAULT_WORD_COLOURING.languages);
  });

  it('an empty tag list goes back to the default names; names are trimmed', () => {
    const result = normaliseWordColouring({tags: {masculine: [], feminine: [' f ', ''], neuter: ['neut', 'nt'], noun: ['noun']}});
    expect(result.tags).toEqual({masculine: ['masc'], feminine: ['f'], neuter: ['neut', 'nt'], noun: ['noun']});
  });

  it('rejects colours that are not #rrggbb and unknown modes', () => {
    const result = normaliseWordColouring({colors: {masculine: 'blue', feminine: '#FF00AA', neuter: '#12'}, ambiguous: 'maybe' as any});
    expect(result.colors).toEqual({masculine: '#4da3ff', feminine: '#FF00AA', neuter: '#5fd068'});
    expect(result.ambiguous).toBe('mark');
  });

  it('the defaults are not shared objects (a change cannot leak into DEFAULT_WORD_COLOURING)', () => {
    const result = normaliseWordColouring(undefined);
    result.tags.masculine.push('m');
    result.languages.push('ja');
    expect(DEFAULT_WORD_COLOURING.tags.masculine).toEqual(['masc']);
    expect(DEFAULT_WORD_COLOURING.languages).not.toContain('ja');
  });
});

describe('wordColouringActiveFor', () => {
  const on = normaliseWordColouring({enabled: true});

  it('colours only the listed languages', () => {
    expect(wordColouringActiveFor(on, 'de')).toBe(true);
    expect(wordColouringActiveFor(on, 'ja')).toBe(false);
    expect(wordColouringActiveFor(on, 'en')).toBe(false);
    expect(wordColouringActiveFor(on, null)).toBe(false);
  });

  it('nothing when switched off', () => {
    expect(wordColouringActiveFor(normaliseWordColouring({enabled: false}), 'de')).toBe(false);
  });
});

describe('wordColouringToggleMessage', () => {
  it('on, off, and on for a language that is not in the list', () => {
    expect(wordColouringToggleMessage(normaliseWordColouring({enabled: true}), 'de', 'German')).toBe('Word colours on');
    expect(wordColouringToggleMessage(normaliseWordColouring({enabled: false}), 'ja', 'Japanese')).toBe('Word colours off');
    expect(wordColouringToggleMessage(normaliseWordColouring({enabled: true}), 'ja', 'Japanese'))
      .toBe('Word colours on, but not for Japanese: add it in Global Settings, Word Colouring');
    expect(wordColouringToggleMessage(normaliseWordColouring({enabled: true}), 'uk')).toContain('not for uk');
    expect(wordColouringToggleMessage(normaliseWordColouring({enabled: true}), undefined)).toBe('Word colours on');
  });
});
