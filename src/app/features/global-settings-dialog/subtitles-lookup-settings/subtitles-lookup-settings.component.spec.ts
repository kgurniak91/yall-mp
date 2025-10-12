import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubtitlesLookupSettingsComponent } from './subtitles-lookup-settings.component';

xdescribe('SubtitlesLookupSettingsComponent', () => {
  let component: SubtitlesLookupSettingsComponent;
  let fixture: ComponentFixture<SubtitlesLookupSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubtitlesLookupSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubtitlesLookupSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
