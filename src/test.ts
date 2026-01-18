import {getTestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule, platformBrowserDynamicTesting,} from '@angular/platform-browser-dynamic/testing';
import {MockInstance, MockService, ngMocks} from 'ng-mocks';
import {DefaultTitleStrategy, TitleStrategy} from '@angular/router';
import {CommonModule} from '@angular/common';
import {ApplicationModule, NgModule, provideExperimentalZonelessChangeDetection} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';

@NgModule({
  providers: [provideExperimentalZonelessChangeDetection()]
})
export class ZonelessTestModule {
}

getTestBed().initTestEnvironment(
  [
    BrowserDynamicTestingModule,
    ZonelessTestModule
  ],
  platformBrowserDynamicTesting(),
  {
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true
  }
);

ngMocks.autoSpy('jasmine');
ngMocks.defaultMock(TitleStrategy, () => MockService(DefaultTitleStrategy));
ngMocks.globalKeep(ApplicationModule, true);
ngMocks.globalKeep(CommonModule, true);
ngMocks.globalKeep(BrowserModule, true);

jasmine.getEnv().addReporter({
  specDone: MockInstance.restore,
  specStarted: MockInstance.remember,
  suiteDone: MockInstance.restore,
  suiteStarted: MockInstance.remember,
});
