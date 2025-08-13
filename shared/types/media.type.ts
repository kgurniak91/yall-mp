export interface MediaTrack {
  index: number;
  language?: string; // The original code from ffprobe (e.g., 'eng', 'fre')
  languageCode?: string; // The standard language code (e.g., 'en', 'fr')
  title?: string;
  label?: string;
}

export interface MediaMetadata {
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
}
