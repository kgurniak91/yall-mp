import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsPresetComponent } from './settings-preset.component';

xdescribe('SettingsPresetComponent', () => {
  let component: SettingsPresetComponent;
  let fixture: ComponentFixture<SettingsPresetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPresetComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsPresetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
