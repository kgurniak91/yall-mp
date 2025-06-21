export interface VideoJsOptions {
  autoplay?: boolean;
  loop?: boolean;
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
  controlBar?: {
    fullscreenToggle?: boolean,
    pictureInPictureToggle?: boolean
    playToggle?: boolean
  },
  userActions?: {
    doubleClick?: boolean
  }
  // more options: https://videojs.com/guides/options
}
