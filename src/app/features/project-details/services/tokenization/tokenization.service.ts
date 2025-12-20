import {inject, Injectable} from '@angular/core';
import {ProjectSettingsStateService} from '../../../../state/project-settings/project-settings-state.service';
import {SupportedLanguage} from '../../../../model/project.types';

@Injectable()
export class TokenizationService {
  private readonly projectSettingsStateService = inject(ProjectSettingsStateService);
  private segmenters = new Map<string, Intl.Segmenter>();

  public getWordBoundaries(text: string, offset: number): { start: number; end: number } | null {
    if (!text || offset < 0 || offset >= text.length) {
      return null;
    }

    const langCode = this.getIsoCode(this.projectSettingsStateService.subtitlesLanguage());

    let segmenter = this.segmenters.get(langCode);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(langCode, {granularity: 'word'});
      this.segmenters.set(langCode, segmenter);
    }

    const segments = segmenter.segment(text);
    const segmentResult = segments.containing(offset);

    if (!segmentResult) {
      return null;
    }

    if (!segmentResult.isWordLike) {
      return null;
    }

    return {
      start: segmentResult.index,
      end: segmentResult.index + segmentResult.segment.length
    };
  }

  private getIsoCode(supportedLang: SupportedLanguage): string {
    if (!supportedLang || supportedLang === 'other') {
      return 'en';
    }

    if (supportedLang === 'zh') {
      return 'zh-CN'; // Preference for Simplified Chinese if generic 'zh'
    }

    return supportedLang;
  }
}
