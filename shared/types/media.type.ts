export interface MediaTrack {
  index: number;
  language?: string; // The original code from ffprobe (e.g., 'eng', 'fre')
  languageCode?: string; // The standard language code (e.g., 'en', 'fr')
  title?: string;
  label?: string;
  codec?: string; // e.g., 'srt', 'ass', 'hdmv_pgs_subtitle'
  isSupported?: boolean; // some of the subtitle types, like image subtitles from Blu-rays, are not supported
}

export interface MediaMetadata {
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  videoWidth?: number;
  videoHeight?: number;
}
