import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommonProjectSettingsComponent } from './common-project-settings.component';

xdescribe('CommonProjectSettingsComponent', () => {
  let component: CommonProjectSettingsComponent;
  let fixture: ComponentFixture<CommonProjectSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonProjectSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CommonProjectSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
