export interface SubtitleFragment {
  text: string;
  isTag: boolean;
}

export interface SubtitlePart {
  text: string;
  style: string;
  fragments?: SubtitleFragment[];
}

interface BaseSubtitleData {
  id: string;
  startTime: number;
  endTime: number;
}

export interface SrtSubtitleData extends BaseSubtitleData {
  type: 'srt';
  text: string;
}

export interface AssSubtitleData extends BaseSubtitleData {
  type: 'ass';
  parts: SubtitlePart[];
}

export type SubtitleData = SrtSubtitleData | AssSubtitleData;
