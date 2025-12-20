import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OfflineDictionariesSettingsComponent } from './offline-dictionaries-settings.component';

xdescribe('OfflineDictionariesSettingsComponent', () => {
  let component: OfflineDictionariesSettingsComponent;
  let fixture: ComponentFixture<OfflineDictionariesSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfflineDictionariesSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OfflineDictionariesSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
