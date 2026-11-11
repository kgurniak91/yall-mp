import {hasEnabledDictionary} from './yomitan.service';

describe('hasEnabledDictionary', () => {
  const installed = [{title: 'kty-en-en'}, {title: 'kty-ru-en'}, {title: 'old-format'}];

  it('is true when any installed dictionary is switched on, whatever language it declares', () => {
    expect(hasEnabledDictionary(installed, [
      {name: 'kty-en-en', enabled: false},
      {name: 'kty-ru-en', enabled: true}
    ])).toBeTrue();
    expect(hasEnabledDictionary(installed, [{name: 'old-format', enabled: true}])).toBeTrue();
  });

  it('is false when everything is off', () => {
    expect(hasEnabledDictionary(installed, [
      {name: 'kty-en-en', enabled: false},
      {name: 'kty-ru-en', enabled: false}
    ])).toBeFalse();
    expect(hasEnabledDictionary(installed, [])).toBeFalse();
  });

  it('ignores a switch left over for a dictionary that is no longer installed', () => {
    expect(hasEnabledDictionary(installed, [{name: 'deleted-dict', enabled: true}])).toBeFalse();
  });
});
