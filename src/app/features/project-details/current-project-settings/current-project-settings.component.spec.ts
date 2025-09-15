import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CurrentProjectSettingsComponent } from './current-project-settings.component';

xdescribe('CurrentProjectSettingsComponent', () => {
  let component: CurrentProjectSettingsComponent;
  let fixture: ComponentFixture<CurrentProjectSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CurrentProjectSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CurrentProjectSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
