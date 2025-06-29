import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {Toast} from 'primeng/toast';
import {ConfirmDialog} from 'primeng/confirmdialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast, ConfirmDialog],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
}
