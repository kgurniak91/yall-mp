import {inject, Injectable} from '@angular/core';
import {
  loadDefaultJapaneseParser,
  loadDefaultSimplifiedChineseParser,
  loadDefaultThaiParser,
  loadDefaultTraditionalChineseParser,
  Parser,
} from 'budoux';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {SupportedLanguage} from '../../../../model/project.types';

interface WordTokenizer {
  getWordBoundaries(text: string, offset: number): { start: number; end: number } | null;
}

@Injectable()
export class TokenizationService {
  private readonly tokenizers = new Map<SupportedLanguage, WordTokenizer>();
  private readonly japaneseParser: Parser;
  private readonly chineseSimplifiedParser: Parser;
  private readonly chineseTraditionalParser: Parser;
  private readonly thaiParser: Parser;
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);

  constructor() {
    this.japaneseParser = loadDefaultJapaneseParser();
    this.chineseSimplifiedParser = loadDefaultSimplifiedChineseParser();
    this.chineseTraditionalParser = loadDefaultTraditionalChineseParser();
    this.thaiParser = loadDefaultThaiParser();
    this.initializeTokenizers();
  }

  public getWordBoundaries(text: string, offset: number): { start: number; end: number } | null {
    if (!text || offset < 0 || offset > text.length) {
      return null;
    }
    const lang = this.projectSettingsStateService.subtitlesLanguage();
    const tokenizer = this.tokenizers.get(lang) || this.tokenizers.get('other')!;
    return tokenizer.getWordBoundaries(text, offset);
  }

  private initializeTokenizers(): void {
    // Default Regex Tokenizer (for English, Korean, etc.)
    this.tokenizers.set('other', {
      getWordBoundaries: (text, offset) => {
        if (!/\p{L}|\p{N}|'|-/u.test(text[offset])) {
          return null;
        }
        let start = offset;
        while (start > 0 && /\p{L}|\p{N}|'|-/u.test(text[start - 1])) {
          start--;
        }
        let end = offset;
        while (end < text.length && /\p{L}|\p{N}|'|-/u.test(text[end])) {
          end++;
        }
        return start === end ? null : {start, end};
      }
    });

    // Helper function to create a BudouX tokenizer from a parser instance
    const createBudouxTokenizer = (parser: Parser): WordTokenizer => ({
      getWordBoundaries: (text, offset) => {
        if (!/\p{L}|\p{N}/u.test(text[offset])) {
          return null;
        }
        const segments = parser.parse(text);
        let currentIndex = 0;
        for (const segment of segments) {
          const start = currentIndex;
          const end = start + segment.length;
          if (offset >= start && offset < end) {
            return {start, end};
          }
          currentIndex = end;
        }
        return null;
      }
    });

    this.tokenizers.set('jpn', createBudouxTokenizer(this.japaneseParser));
    this.tokenizers.set('cmn', createBudouxTokenizer(this.chineseSimplifiedParser));
    this.tokenizers.set('zho', createBudouxTokenizer(this.chineseTraditionalParser));
    this.tokenizers.set('tha', createBudouxTokenizer(this.thaiParser));
  }
}
