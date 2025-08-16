import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {Toast} from 'primeng/toast';
import {ConfirmDialog} from 'primeng/confirmdialog';
import {HeaderComponent} from './core/layout/header/header.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast, ConfirmDialog, HeaderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
}
