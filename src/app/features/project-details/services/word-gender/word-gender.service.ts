import {computed, inject, Injectable} from '@angular/core';
import {YomitanService} from '../../../../core/services/yomitan/yomitan.service';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {wordColouringActiveFor} from '../../../../model/settings.types';
import {prepareTagNames, TermsFindResult} from './gender-reader';
import {languagePack} from './language-packs';
import {ColouredWord, colourLine} from './line-colouring';
import {NOT_CACHED, WordLookupCache} from './word-lookup-cache';

/**
 * Colours subtitle lines by grammatical gender. Asks Yomitan (the user's own dictionaries, the profile of the
 * subtitle language) for each word once, and remembers the answers until the language or the dictionaries change.
 * Runs only for the languages listed in the settings: a language without grammatical gender is never looked up.
 */
@Injectable({
  providedIn: 'root'
})
export class WordGenderService {
  private readonly yomitanService = inject(YomitanService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);

  private readonly cache = new WordLookupCache<TermsFindResult>(word => this.ask(word));
  private cacheGeneration = -1;

  private readonly tags = computed(() => prepareTagNames(this.globalSettingsStateService.wordColouring().tags));

  /**
   * The coloured words of `text` in the language Yomitan is synced to, or [] when colouring is off, the language is
   * not in the list, or Yomitan has not been synced yet (the line is coloured again once it is:
   * `yomitanService.syncedLanguage` changes). Starting a line drops the queued lookups of the lines before it.
   */
  async colour(text: string): Promise<ColouredWord[]> {
    const settings = this.globalSettingsStateService.wordColouring();
    const synced = this.yomitanService.syncedLanguage();
    if (!synced || !wordColouringActiveFor(settings, synced.iso)) {
      return [];
    }
    if (synced.generation !== this.cacheGeneration) {
      this.cache.clear();
      this.cacheGeneration = synced.generation;
    }
    const line = this.cache.newLine();
    return colourLine(text, {
      language: synced.iso,
      pack: languagePack(synced.iso),
      tags: this.tags(),
      articles: settings.articles,
      ambiguous: settings.ambiguous,
      lookup: word => this.cache.lookup(word, line)
    });
  }

  private async ask(word: string): Promise<TermsFindResult | null | typeof NOT_CACHED> {
    const response = await window.electronAPI.invokeExtension({
      action: 'termsFind',
      params: {text: word, optionsContext: {current: true}, details: {matchType: 'exact', deinflect: true}}
    });
    // An error reply (database still opening, say) is not "no entry": ask again next time
    if (response?.error) {
      return NOT_CACHED;
    }
    return response?.result ?? null;
  }
}
