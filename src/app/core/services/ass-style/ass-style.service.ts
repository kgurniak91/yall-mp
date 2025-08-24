import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AssStyleService {
  private styleMap = new Map<string, any>();

  public setStyles(stylesData: any): void {
    this.styleMap.clear();

    if (stylesData) {
      for (const styleName of Object.keys(stylesData)) {
        const styleContainer = stylesData[styleName];
        if (styleContainer && styleContainer.style) {
          const styleDef = styleContainer.style;
          this.styleMap.set(styleDef.Name, styleDef);
        }
      }
    }
  }

  public getStyleAsNgStyle(styleName: string): { [key: string]: any } {
    const styleDef = this.styleMap.get(styleName);
    if (!styleDef) {
      return {};
    }

    const ngStyle: { [key: string]: any } = {
      'font-size': `${styleDef.Fontsize}px`,
      'color': this.convertAssColorToRgba(styleDef.PrimaryColour),
      'font-family': `"${styleDef.Fontname}"`,
      'font-weight': styleDef.Bold === -1 ? 'bold' : 'normal',
      'font-style': styleDef.Italic === -1 ? 'italic' : 'normal',
      'text-decoration': styleDef.Underline === -1 ? 'underline' : 'none',
      //'position': 'absolute', // TODO
      '--margin-l': `${styleDef.MarginL}px`,
      '--margin-r': `${styleDef.MarginR}px`,
      '--margin-v': `${styleDef.MarginV}px`,
    };

    // Translate ASS Alignment (numpad values) to CSS
    switch (styleDef.Alignment) {
      case 1: // Bottom left
        ngStyle['bottom'] = 'var(--margin-v)';
        ngStyle['left'] = 'var(--margin-l)';
        ngStyle['text-align'] = 'left';
        break;
      case 2: // Bottom center
        ngStyle['bottom'] = 'var(--margin-v)';
        ngStyle['left'] = '50%';
        ngStyle['transform'] = 'translateX(-50%)';
        ngStyle['text-align'] = 'center';
        break;
      case 3: // Bottom right
        ngStyle['bottom'] = 'var(--margin-v)';
        ngStyle['right'] = 'var(--margin-r)';
        ngStyle['text-align'] = 'right';
        break;
      case 4: // Middle left
        ngStyle['top'] = '50%';
        ngStyle['left'] = 'var(--margin-l)';
        ngStyle['transform'] = 'translateY(-50%)';
        ngStyle['text-align'] = 'left';
        break;
      case 5: // Middle center
        ngStyle['top'] = '50%';
        ngStyle['left'] = '50%';
        ngStyle['transform'] = 'translate(-50%, -50%)';
        ngStyle['text-align'] = 'center';
        break;
      case 6: // Middle right
        ngStyle['top'] = '50%';
        ngStyle['right'] = 'var(--margin-r)';
        ngStyle['transform'] = 'translateY(-50%)';
        ngStyle['text-align'] = 'right';
        break;
      case 7: // Top left
        ngStyle['top'] = 'var(--margin-v)';
        ngStyle['left'] = 'var(--margin-l)';
        ngStyle['text-align'] = 'left';
        break;
      case 8: // Top center
        ngStyle['top'] = 'var(--margin-v)';
        ngStyle['left'] = '50%';
        ngStyle['transform'] = 'translateX(-50%)';
        ngStyle['text-align'] = 'center';
        break;
      case 9: // Top right
        ngStyle['top'] = 'var(--margin-v)';
        ngStyle['right'] = 'var(--margin-r)';
        ngStyle['text-align'] = 'right';
        break;
    }

    return ngStyle;
  }

  private convertAssColorToRgba(assColor: string): string {
    if (!assColor || !assColor.startsWith('&H')) {
      return 'rgba(255, 255, 255, 1)';
    }

    const [aa = '00', bb = 'FF', gg = 'FF', rr = 'FF'] = assColor.substring(2).match(/.{1,2}/g) || [];

    const alpha = 1 - (parseInt(aa, 16) / 255);
    const blue = parseInt(bb, 16);
    const green = parseInt(gg, 16);
    const red = parseInt(rr, 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
}
