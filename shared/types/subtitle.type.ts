export interface SubtitlePart {
  text: string;
  style: string;
}

export interface SubtitleData {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  parts?: SubtitlePart[];
}
