import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnkiSettingsComponent } from './anki-settings.component';

xdescribe('AnkiSettingsComponent', () => {
  let component: AnkiSettingsComponent;
  let fixture: ComponentFixture<AnkiSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnkiSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnkiSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
