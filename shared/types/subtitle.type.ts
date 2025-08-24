export interface SubtitlePart {
  text: string;
  style: string;
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
