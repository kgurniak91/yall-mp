import {Injectable} from '@angular/core';
import {FontData} from '../../../../../electron-api';

const STYLE_TAG_ID = 'dynamic-ass-fonts';

@Injectable()
export class FontInjectionService {
  private styleTag: HTMLStyleElement | null = null;

  public injectFontsIntoDOM(fonts: FontData[]): void {
    this.clearFonts();

    if (!fonts || fonts.length === 0) {
      return;
    }

    const cssRules = fonts.map(font => `
      @font-face {
        font-family: "${font.fontFamily}";
        src: url(${font.dataUri});
      }
    `).join('\n');

    this.styleTag = document.createElement('style');
    this.styleTag.id = STYLE_TAG_ID;
    this.styleTag.innerHTML = cssRules;
    document.head.appendChild(this.styleTag);
  }

  public clearFonts(): void {
    const existingTag = document.getElementById(STYLE_TAG_ID);
    if (existingTag) {
      document.head.removeChild(existingTag);
    }
    this.styleTag = null;
  }
}
