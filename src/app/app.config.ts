import {ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';

import {routes} from './app.routes';
import {provideAnimationsAsync} from '@angular/platform-browser/animations/async';
import {providePrimeNG} from 'primeng/config';
import Nora from '@primeng/themes/nora';
import {ConfirmationService, MessageService} from 'primeng/api';
import {DATE_PIPE_DEFAULT_OPTIONS} from '@angular/common';
import {DialogService} from 'primeng/dynamicdialog';
import {AppStateService} from './state/app/app-state.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Nora
      },
      ripple: true
    }),
    MessageService,
    ConfirmationService,
    DialogService,
    {
      provide: DATE_PIPE_DEFAULT_OPTIONS,
      useValue: {
        dateFormat: 'yyyy-MM-dd HH:mm:ss'
      }
    },
    provideAppInitializer(async () => inject(AppStateService).loadAppData())
  ]
};
