import {TokenizationService} from './tokenization.service';
import {createServiceFactory, SpectatorService} from '@ngneat/spectator';
import {signal} from '@angular/core';
import {SupportedLanguage} from '../../../../model/project.types';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {MockBuilder} from 'ng-mocks';

const DEFAULT_LANGUAGE: SupportedLanguage = 'other';

describe('TokenizationService', () => {
  const mockLanguageSignal = signal<SupportedLanguage>(DEFAULT_LANGUAGE);

  const dependencies = MockBuilder(TokenizationService)
    .mock(ProjectSettingsStateService, {
      subtitlesLanguage: mockLanguageSignal.asReadonly()
    })
    .build();

  const createService = createServiceFactory({
    service: TokenizationService,
    ...dependencies
  });

  let spectator: SpectatorService<TokenizationService>;
  let service: TokenizationService;

  beforeEach(() => {
    spectator = createService();
    service = spectator.inject(TokenizationService);
    mockLanguageSignal.set(DEFAULT_LANGUAGE);
  });

  describe('Language Dispatching', () => {
    it('uses Japanese tokenization logic for Japanese text', () => {
      mockLanguageSignal.set('jpn');
      const result = service.getWordBoundaries('日本語の形態素解析', 4);
      expect(result).toEqual({start: 4, end: 9});
    });

    it('uses Simplified Chinese tokenization logic for Simplified Chinese text', () => {
      mockLanguageSignal.set('cmn');
      const result = service.getWordBoundaries('中文分词测试', 3);
      expect(result).toEqual({start: 0, end: 4});
    });

    it('uses Traditional Chinese tokenization logic for Traditional Chinese text', () => {
      mockLanguageSignal.set('zho');
      const result = service.getWordBoundaries('繁體中文測試', 4);
      expect(result).toEqual({start: 4, end: 6});
    });

    it('uses Thai tokenization logic for Thai text', () => {
      mockLanguageSignal.set('tha');
      const result = service.getWordBoundaries('ภาษาไทยง่ายนิดเดียว', 5);
      expect(result).toEqual({start: 0, end: 7});
    });

    it('uses regex tokenization logic for Korean text (as "other")', () => {
      mockLanguageSignal.set('other');
      const result = service.getWordBoundaries('한국어를 공부하고 있어요', 5);
      expect(result).toEqual({start: 5, end: 9});
    });

    it('uses regex tokenization logic for English text (as "other")', () => {
      mockLanguageSignal.set('other');
      const result = service.getWordBoundaries('This is a test', 6);
      expect(result).toEqual({start: 5, end: 7});
    });
  });

  describe('Japanese Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('jpn');
    });

    it('finds a word in a Japanese sentence', () => {
      const text = '日本語の形態素解析';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 4, end: 9});
    });

    it('returns null for punctuation', () => {
      const text = 'はい、そうです。';
      const result = service.getWordBoundaries(text, 2);
      expect(result).toBeNull();
    });
  });

  describe('Chinese Simplified Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('cmn');
    });

    it('finds a word in a simple Chinese sentence', () => {
      const text = '中文分词测试';
      const result = service.getWordBoundaries(text, 3);
      expect(result).toEqual({start: 0, end: 4});
    });

    it('handles mixed English and Chinese', () => {
      const text = '我喜欢Apple Watch';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 4, end: 14});
    });

    it('returns null for punctuation', () => {
      const text = '你好，世界！';
      const result = service.getWordBoundaries(text, 2);
      expect(result).toBeNull();
    });
  });

  describe('Chinese Traditional Tokenization', () => {
    it('finds a word in a simple traditional chinese sentence', () => {
      mockLanguageSignal.set('zho');
      const text = '繁體中文測試';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 4, end: 6});
    });
  });

  describe('Thai Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('tha');
    });

    it('finds a word in a simple Thai sentence', () => {
      const text = 'ภาษาไทยง่ายนิดเดียว';
      const result = service.getWordBoundaries(text, 5);
      expect(result).toEqual({start: 0, end: 7});
    });

    it('correctly segments a more complex sentence', () => {
      const text = 'การทดสอบการตัดคำ';
      const result = service.getWordBoundaries(text, 10);
      expect(result).toEqual({start: 8, end: 11});
    });
  });

  describe('Regex Fallback (English, Korean etc.)', () => {
    beforeEach(() => {
      mockLanguageSignal.set('other');
    });

    it('finds a word in an English sentence', () => {
      const text = 'This is a test sentence.';
      const result = service.getWordBoundaries(text, 6);
      expect(result).toEqual({start: 5, end: 7});
    });

    it('handles words with apostrophes', () => {
      const text = "It's a beautiful day.";
      const offset = 2;
      const result = service.getWordBoundaries(text, offset);
      expect(result).toEqual({start: 0, end: 4});
    });

    it('returns null when clicking on a space', () => {
      const text = 'A simple test';
      const offset = 1;
      const result = service.getWordBoundaries(text, offset);
      expect(result).toBeNull();
    });

    it('handles mixed English and Korean', () => {
      const text = '나는 iPhone을 사용해요';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 3, end: 10});
    });
  });
});
