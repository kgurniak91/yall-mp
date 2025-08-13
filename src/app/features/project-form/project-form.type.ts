export enum SubtitleOptionType {
  embedded = 'embedded',
  external = 'external',
  none = 'none',
}

export interface SubtitleOptionConfig {
  value: SubtitleOptionType;
  label: string;
}

export const SUBTITLE_OPTIONS: SubtitleOptionConfig[] = [
  {value: SubtitleOptionType.embedded, label: 'Use embedded subtitles'},
  {value: SubtitleOptionType.external, label: 'Use external file'},
  {value: SubtitleOptionType.none, label: 'No subtitles'}
];
