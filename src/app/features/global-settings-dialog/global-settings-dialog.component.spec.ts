import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlobalSettingsDialogComponent } from './global-settings-dialog.component';

describe('GlobalSettingsDialogComponent', () => {
  let component: GlobalSettingsDialogComponent;
  let fixture: ComponentFixture<GlobalSettingsDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalSettingsDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GlobalSettingsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
