export interface VideoJsOptions {
  autoplay?: boolean;
  controls?: boolean;
  sources: {
    src: string;
    type: string;
  }[];
  fluid?: boolean;
  responsive?: boolean;
  aspectRatio?: string;
  poster?: string;
  muted?: boolean;
  inactivityTimeout?: number;
  // more options: https://videojs.com/guides/options
}
