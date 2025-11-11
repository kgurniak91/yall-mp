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
import {definePreset} from '@primeng/themes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: definePreset(Nora, {
          semantic: {
            primary: {
              50: '{blue.50}',
              100: '{blue.100}',
              200: '{blue.200}',
              300: '{blue.300}',
              400: '{blue.400}',
              500: '{blue.500}',
              600: '{blue.600}',
              700: '{blue.700}',
              800: '{blue.800}',
              900: '{blue.900}',
              950: '{blue.950}'
            }
          }
        }),
        options: {
          darkModeSelector: false
        }
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
