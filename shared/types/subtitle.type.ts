export interface SubtitleFragment {
  text: string;
  isTag: boolean;
}

export interface SubtitlePart {
  text: string;
  style: string;
  fragments?: SubtitleFragment[];
  y?: number; // Vertical position on the screen
}

interface BaseSubtitleData {
  id: string;
  startTime: number;
  endTime: number;
  track: number;
}

export interface SrtSubtitleData extends BaseSubtitleData {
  type: 'srt';
  text: string;
}

export interface AssSubtitleData extends BaseSubtitleData {
  type: 'ass';
  parts: SubtitlePart[];
  sourceDialogues?: AssSubtitleData[];
}

export type SubtitleData = SrtSubtitleData | AssSubtitleData;

/**
 * Type used by edit-subtitles-dialog and export-to-anki-dialog to asssign track number for each part of merged subtitled clip
 */
export interface DialogSubtitlePart extends SubtitlePart {
  track: number;
}
