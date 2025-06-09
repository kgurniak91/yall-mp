export interface VideoClip {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text?: string;
  hasSubtitle: boolean;
}
