export interface SubtitlePart {
  text: string;
  style: string;
}

interface BaseSubtitleData {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface SrtSubtitleData extends BaseSubtitleData {
  type: 'srt';
}

export interface AssSubtitleData extends BaseSubtitleData {
  type: 'ass';
  parts: SubtitlePart[];
}

export type SubtitleData = SrtSubtitleData | AssSubtitleData;
