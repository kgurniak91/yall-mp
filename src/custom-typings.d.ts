declare module 'font-scanner' {
  interface FontDescriptor {
    path: string;
    postscriptName: string;
    family: string;
    style: string;
    weight: number;
    width: number;
    italic: boolean;
    monospace: boolean;
  }

  interface FindFontOptions {
    family: string;
    italic?: boolean;
    weight?: number;
  }

  function findFont(options: FindFontOptions): Promise<FontDescriptor | null>;
  function getAvailableFonts(): Promise<FontDescriptor[]>;
}
