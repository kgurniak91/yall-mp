import {Component, input} from '@angular/core';

@Component({
  selector: 'app-logo',
  imports: [],
  template: '',
  styleUrl: './logo.component.scss',
  host: {
    '[style.width]': 'size()',
    '[style.height]': 'size()',
    '[style.background-color]': 'color()',
    '[style.webkitMaskImage]': '"url(yall-mp-logo.svg)"',
    '[style.maskImage]': '"url(yall-mp-logo.svg)"'
  }
})
export class LogoComponent {
  size = input.required<string>();
  color = input<string>('#234E76');
}
