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
      mockLanguageSignal.set('ja');
      const result = service.getWordBoundaries('日本語の形態素解析', 4);
      expect(result).toEqual({start: 4, end: 7});
    });

    it('uses Chinese tokenization logic for Chinese text', () => {
      mockLanguageSignal.set('zh');
      const result = service.getWordBoundaries('中文分词测试', 3);
      expect(result).toEqual({start: 2, end: 4});
    });

    it('uses Thai tokenization logic for Thai text', () => {
      mockLanguageSignal.set('th');
      const result = service.getWordBoundaries('ภาษาไทยง่ายนิดเดียว', 5);
      expect(result).toEqual({start: 4, end: 7});
    });

    it('uses Korean tokenization logic for Korean text', () => {
      mockLanguageSignal.set('ko');
      const result = service.getWordBoundaries('한국어를 공부하고 있어요', 5);
      expect(result).toEqual({start: 5, end: 9});
    });

    it('uses English tokenization logic for English text', () => {
      mockLanguageSignal.set('en');
      const result = service.getWordBoundaries('This is a test', 6);
      expect(result).toEqual({start: 5, end: 7});
    });
  });

  describe('Japanese Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('ja');
    });

    it('finds a word in a Japanese sentence', () => {
      const text = '日本語の形態素解析';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 4, end: 7});
    });

    it('returns null for punctuation', () => {
      const text = 'はい、そうです。';
      const result = service.getWordBoundaries(text, 2);
      expect(result).toBeNull();
    });
  });

  describe('Chinese Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('zh');
    });

    it('finds a word in a simple Chinese sentence', () => {
      const text = '中文分词测试';
      const result = service.getWordBoundaries(text, 3);
      expect(result).toEqual({start: 2, end: 4});
    });

    it('handles mixed English and Chinese', () => {
      const text = '我喜欢Apple Watch';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 3, end: 8});
    });

    it('returns null for punctuation', () => {
      const text = '你好，世界！';
      const result = service.getWordBoundaries(text, 2);
      expect(result).toBeNull();
    });
  });

  describe('Thai Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('th');
    });

    it('finds a word in a simple Thai sentence', () => {
      const text = 'ภาษาไทยง่ายนิดเดียว';
      const result = service.getWordBoundaries(text, 5);
      expect(result).toEqual({start: 4, end: 7});
    });

    it('correctly segments a more complex sentence', () => {
      const text = 'การทดสอบการตัดคำ';
      const result = service.getWordBoundaries(text, 10);
      expect(result).toEqual({start: 8, end: 11});
    });
  });

  describe('English Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('en');
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
  });

  describe('Korean Tokenization', () => {
    beforeEach(() => {
      mockLanguageSignal.set('ko');
    });

    it('finds a word in a Korean sentence', () => {
      const text = '한국어를 공부하고 있어요';
      const result = service.getWordBoundaries(text, 5);
      expect(result).toEqual({start: 5, end: 9});
    });

    it('handles mixed English and Korean', () => {
      const text = '나는 iPhone을 사용해요';
      const result = service.getWordBoundaries(text, 4);
      expect(result).toEqual({start: 3, end: 9});
    });
  });
});
